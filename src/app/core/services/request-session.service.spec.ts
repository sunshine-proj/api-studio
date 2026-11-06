import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME } from '../database/database.service';
import { ExecutionResult, RequestDefinition } from '../models';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { ExecutionContext, RequestExecutionService } from './request-execution.service';
import { RequestSession } from './request-session.service';
import { SavedRequestStore } from './saved-request-store.service';
import { SettingsStore } from './settings-store.service';

let counter = 0;

class FakeExecutor extends RequestExecutionService {
  calls: { definition: RequestDefinition; context: ExecutionContext }[] = [];
  release!: (result: ExecutionResult) => void;

  execute(definition: RequestDefinition, context: ExecutionContext): Promise<ExecutionResult> {
    this.calls.push({ definition, context });
    return new Promise((resolve) => (this.release = resolve));
  }
}

describe('RequestSession', () => {
  let session: RequestSession;
  let executor: FakeExecutor;
  let dbName: string;

  beforeEach(() => {
    dbName = `session-db-${++counter}`;
    executor = new FakeExecutor();
    TestBed.configureTestingModule({
      providers: [
        { provide: RequestExecutionService, useValue: executor },
        { provide: DATABASE_NAME, useValue: dbName },
      ],
    });
    session = TestBed.inject(RequestSession);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('keeps URL and params in sync in both directions', () => {
    session.setUrl('https://a.test/x?q=1&r=2');
    expect(session.draft().params.map((p) => [p.key, p.value])).toEqual([['q', '1'], ['r', '2']]);

    const [first, second] = session.draft().params;
    session.setParams([{ ...first, value: 'one' }, { ...second, enabled: false }]);
    expect(session.draft().url).toBe('https://a.test/x?q=one');
  });

  it('sends with the active environment variables and publishes the result', async () => {
    const store = TestBed.inject(EnvironmentStore);
    await Promise.all([store.ready, TestBed.inject(SettingsStore).ready]);
    const env = (await store.create('Dev'))!;
    store.setVariables(env.id, [{ id: '1', name: 'h', value: 'v', enabled: true, secret: false }]);
    await store.setActive(env.id);

    const sending = session.send();
    expect(session.state().status).toBe('sending');
    expect(executor.calls[0].context.variables.get('h')).toBe('v');

    const result: ExecutionResult = {
      ok: false,
      error: { kind: 'network', message: 'x' },
      request: null,
      durationMs: 1,
      warnings: [],
    };
    executor.release(result);
    await sending;
    expect(session.state()).toEqual({ status: 'done', result });
  });

  it('ignores a second send while one is running', async () => {
    const first = session.send();
    await session.send();
    expect(executor.calls).toHaveLength(1);
    session.cancel();
    expect(executor.calls[0].context.signal?.aborted).toBe(true);
    executor.release({ ok: false, error: { kind: 'aborted', message: 'c' }, request: null, durationMs: 0, warnings: [] });
    await first;
  });

  it('restores the content of a body type after switching away and back', () => {
    session.setBodyKind('json');
    session.setBodyText('{"a":1}');
    session.setBodyKind('urlencoded');
    session.setUrlencoded([{ id: '1', key: 'k', value: 'v', enabled: true }]);
    session.setBodyKind('xml');
    expect(session.draft().body).toEqual({ type: 'text', language: 'xml', content: '{"a":1}' });
    session.setBodyKind('urlencoded');
    expect(session.draft().body).toMatchObject({ type: 'urlencoded', fields: [{ key: 'k' }] });
    session.setBodyKind('none');
    expect(session.draft().body).toEqual({ type: 'none' });
  });

  it('keeps several files, including repeated field names, and releases removed ones', () => {
    session.setBodyKind('multipart');
    const a = new File(['a'], 'a.txt', { type: 'text/plain' });
    const b = new File(['bb'], 'b.txt');
    session.addMultipartFiles([a, b], 'docs');

    const body = session.draft().body;
    if (body.type !== 'multipart') throw new Error('expected a multipart body');
    const fields = body.fields;
    expect(fields.map((f) => [f.key, f.file?.name, f.file?.size])).toEqual([['docs', 'a.txt', 1], ['docs', 'b.txt', 2]]);
    expect(session.files().get(fields[0].id)).toBe(a);

    session.setMultipart([fields[1]]);
    expect(session.files().has(fields[0].id)).toBe(false);
    expect(session.files().has(fields[1].id)).toBe(true);
  });

  it('stores the binary file separately and clears it', () => {
    session.setBodyKind('binary');
    const file = new File(['xyz'], 'x.bin');
    session.setBinaryFile(file);
    expect(session.files().get('binary')).toBe(file);
    expect(session.draft().body).toEqual({ type: 'binary', file: { name: 'x.bin', size: 3, mimeType: '' } });
    session.setBinaryFile(null);
    expect(session.files().has('binary')).toBe(false);
  });

  it('passes files to the executor and publishes upload progress while sending', async () => {
    session.setBodyKind('binary');
    const file = new File(['xyz'], 'x.bin');
    session.setBinaryFile(file);
    const sending = session.send();
    const { context } = executor.calls[0];
    expect(context.files?.get('binary')).toBe(file);

    context.onUploadProgress?.({ loaded: 1, total: 3 });
    expect(session.uploadProgress()).toEqual({ loaded: 1, total: 3 });
    executor.release({ ok: false, error: { kind: 'aborted', message: 'c' }, request: null, durationMs: 0, warnings: [] });
    await sending;
    expect(session.uploadProgress()).toBeNull();
  });

  describe('tabs', () => {
    let saved: SavedRequestStore;
    let collectionId: string;

    beforeEach(async () => {
      const collections = TestBed.inject(CollectionStore);
      saved = TestBed.inject(SavedRequestStore);
      await Promise.all([collections.ready, saved.ready]);
      collectionId = (await collections.createCollection('API'))!.id;
    });

    const abortedResult = (): ExecutionResult => ({
      ok: false,
      error: { kind: 'aborted', message: 'c' },
      request: null,
      durationMs: 0,
      warnings: [],
    });

    it('starts with one empty, clean tab', () => {
      expect(session.tabs()).toHaveLength(1);
      expect(session.activeTab().title()).toBe('New request');
      expect(session.hasUnsavedChanges()).toBe(false);
    });

    it('keeps each tab\'s edits and response when switching', async () => {
      const first = session.activeTab();
      session.setUrl('https://a.test/one');
      session.setBodyKind('json');
      session.setBodyText('{"a":1}');
      const second = session.newTab();
      expect(session.activeId()).toBe(second.id);
      expect(session.draft().url).toBe('');
      session.setUrl('https://a.test/two');

      session.activate(first.id);
      expect(session.draft().url).toBe('https://a.test/one');
      expect(session.draft().body).toEqual({ type: 'text', language: 'json', content: '{"a":1}' });
      session.activate(second.id);
      expect(session.draft().url).toBe('https://a.test/two');
      expect(session.hasUnsavedChanges()).toBe(true);

      const sending = session.send();
      session.activate(first.id);
      expect(session.state().status).toBe('idle'); // the other tab's request does not leak into this one
      session.activate(second.id);
      expect(session.state().status).toBe('sending');
      executor.release(abortedResult());
      await sending;
      expect(session.state().status).toBe('done');
    });

    it('can run a request in each tab at the same time', async () => {
      const first = session.activeTab();
      const sendingFirst = session.send();
      const second = session.newTab();
      const sendingSecond = session.send();
      expect(first.sending()).toBe(true);
      expect(second.sending()).toBe(true);
      expect(executor.calls).toHaveLength(2);
      second.cancel();
      expect(executor.calls[1].context.signal?.aborted).toBe(true);
      expect(executor.calls[0].context.signal?.aborted).toBe(false);
      executor.release(abortedResult());
      await sendingSecond;
      first.cancel();
      await Promise.resolve();
      void sendingFirst;
    });

    it('saves a new request, then tracks unsaved changes against the stored version', async () => {
      const tab = session.activeTab();
      session.setUrl('https://a.test/users');
      expect(tab.dirty()).toBe(true);
      expect(await session.save(tab.id)).toBe('needs-location');

      expect(await session.saveAs(tab.id, { name: 'Users', collectionId, folderId: null })).toBe(true);
      expect(tab.title()).toBe('Users');
      expect(tab.isSaved()).toBe(true);
      expect(tab.dirty()).toBe(false);

      session.setMethod('POST');
      expect(tab.dirty()).toBe(true);
      expect(await session.save(tab.id)).toBe('saved');
      expect(tab.dirty()).toBe(false);
      expect(saved.requests()[0].definition.method).toBe('POST');

      session.setMethod('GET');
      session.setMethod('POST');
      expect(tab.dirty()).toBe(false); // reverting an edit is not an unsaved change
    });

    it('creates a new collection when saving into one that does not exist yet', async () => {
      const tab = session.activeTab();
      session.setUrl('https://a.test/y');
      expect(await session.saveAs(tab.id, { name: 'Y', collectionId: null, newCollectionName: 'Fresh', folderId: null })).toBe(true);
      const collections = TestBed.inject(CollectionStore).collections();
      expect(collections.map((c) => c.name)).toContain('Fresh');
      expect(saved.requests()[0].collectionId).toBe(collections.find((c) => c.name === 'Fresh')!.id);
    });

    it('reports a failed save and keeps the tab dirty', async () => {
      const tab = session.activeTab();
      session.setUrl('https://a.test/x');
      saved.clearError();
      expect(await session.saveAs(tab.id, { name: 'X', collectionId: 'missing', folderId: null })).toBe(false);
      expect(tab.isSaved()).toBe(false);
      expect(tab.dirty()).toBe(true);
      expect(saved.error()).toContain('no longer exists');
    });

    it('opens a saved request once and focuses its tab afterwards', async () => {
      const request = (await saved.create('Get users', collectionId, null, { ...session.draft(), url: 'https://a.test/u' }))!;
      session.openSaved(request.id);
      // the pristine starter tab is reused instead of keeping an empty one beside it
      expect(session.tabs()).toHaveLength(1);
      expect(session.activeTab().title()).toBe('Get users');
      expect(session.draft().url).toBe('https://a.test/u');

      const other = session.newTab();
      session.openSaved(request.id);
      expect(session.tabs()).toHaveLength(2);
      expect(session.activeTab()).not.toBe(other);
      expect(session.activeTab().savedRequestId()).toBe(request.id);
    });

    it('follows a rename of the saved request', async () => {
      const request = (await saved.create('Old', collectionId, null, session.draft()))!;
      session.openSaved(request.id);
      await saved.rename(request.id, 'New name');
      expect(session.activeTab().title()).toBe('New name');
    });

    it('turns a tab into an unsaved one when its request is deleted', async () => {
      const request = (await saved.create('Doomed', collectionId, null, { ...session.draft(), url: 'https://a.test/d' }))!;
      session.openSaved(request.id);
      expect(session.activeTab().dirty()).toBe(false);
      await saved.remove(request.id);
      const tab = session.activeTab();
      expect(tab.isSaved()).toBe(false);
      expect(tab.dirty()).toBe(true);
      expect(await session.save(tab.id)).toBe('needs-location');
    });

    it('duplicates a tab as an unsaved copy placed after it, with its files', () => {
      session.setBodyKind('binary');
      const file = new File(['x'], 'x.bin');
      session.setBinaryFile(file);
      const original = session.activeTab();
      session.newTab();
      session.duplicateTab(original.id);
      expect(session.tabs().map((t) => t.id)[1]).toBe(session.activeId());
      expect(session.activeId()).not.toBe(original.id);
      expect(session.files().get('binary')).toBe(file);
      expect(session.activeTab().savedRequestId()).toBeNull();
    });

    it('closes tabs, picks a neighbour, cancels the request and always keeps one tab', () => {
      const a = session.activeTab();
      const b = session.newTab();
      const c = session.newTab();
      void session.send();
      session.activate(b.id);
      session.closeTab(b.id);
      expect(session.activeId()).toBe(c.id);

      session.closeTab(c.id);
      expect(executor.calls[0].context.signal?.aborted).toBe(true);
      expect(session.activeId()).toBe(a.id);

      session.closeTab(a.id);
      expect(session.tabs()).toHaveLength(1);
      expect(session.activeId()).not.toBe(a.id);
    });

    it('ignores unknown tab ids', () => {
      const before = session.activeId();
      session.activate('nope');
      session.closeTab('nope');
      session.duplicateTab('nope');
      expect(session.activeId()).toBe(before);
      expect(session.tabs()).toHaveLength(1);
    });
  });
});
