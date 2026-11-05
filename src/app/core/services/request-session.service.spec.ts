import { TestBed } from '@angular/core/testing';
import { ExecutionResult, RequestDefinition } from '../models';
import { EnvironmentStore } from './environment-store.service';
import { ExecutionContext, RequestExecutionService } from './request-execution.service';
import { RequestSession } from './request-session.service';

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

  beforeEach(() => {
    executor = new FakeExecutor();
    TestBed.configureTestingModule({ providers: [{ provide: RequestExecutionService, useValue: executor }] });
    session = TestBed.inject(RequestSession);
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
    const env = store.create('Dev');
    store.setVariables(env.id, [{ id: '1', name: 'h', value: 'v', enabled: true, secret: false }]);
    store.setActive(env.id);

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
});
