import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Assertion,
  AuthConfig,
  Extraction,
  FormDataField,
  KeyValue,
  RequestDefinition,
  RequestScripts,
} from '../models';
import { RealtimeTab } from '../realtime/realtime-tab';
import { RealtimeKind } from '../realtime/realtime.model';
import { WEBSOCKET_FACTORY } from '../realtime/websocket-factory';
import { FETCH_IMPLEMENTATION } from './browser-fetch-executor.service';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { HistoryStore } from './history-store.service';
import { RequestPipeline } from './request-pipeline.service';
import { BodyKind, ExecutionState, RequestTab, fileReference } from './request-tab';
import { SavedRequestStore } from './saved-request-store.service';

export { fileReference };
export type { BodyKind, ExecutionState };

/** A tab in the strip: an HTTP request, or a WebSocket / event stream connection. */
export type SessionTab = RequestTab | RealtimeTab;

export type SaveOutcome = 'saved' | 'needs-location' | 'failed';

export interface SaveLocation {
  readonly name: string;
  /** Null when `newCollectionName` names a collection to create for it. */
  readonly collectionId: string | null;
  readonly newCollectionName?: string | null;
  readonly folderId: string | null;
}

/**
 * The open tabs. The editing methods act on the active HTTP tab, so the editor
 * components bind to one object whichever tab is showing. Switching tabs never
 * discards a tab's unsaved edits, selected files or last response. WebSocket and
 * event stream tabs live here too; they are never saved to collections.
 */
@Injectable({ providedIn: 'root' })
export class RequestSession {
  private readonly pipeline = inject(RequestPipeline);
  private readonly environments = inject(EnvironmentStore);
  private readonly store = inject(SavedRequestStore);
  private readonly collections = inject(CollectionStore);
  private readonly history = inject(HistoryStore);
  private readonly fetchImpl = inject(FETCH_IMPLEMENTATION);
  private readonly websocketFactory = inject(WEBSOCKET_FACTORY);

  private readonly tabsState = signal<readonly SessionTab[]>([this.createTab()]);
  private readonly activeIdState = signal(this.tabsState()[0].id);
  /** Target of the editing facade while a realtime tab is active (nothing shows it). */
  private readonly idleHttpTab = this.createTab();

  readonly tabs = this.tabsState.asReadonly();
  readonly activeId = this.activeIdState.asReadonly();
  readonly activeTab = computed<SessionTab>(() => this.tabs().find((tab) => tab.id === this.activeId()) ?? this.tabs()[0]);
  /** The active tab when it is an HTTP request. */
  readonly activeRequest = computed<RequestTab | null>(() => {
    const tab = this.activeTab();
    return tab.kind === 'http' ? tab : null;
  });
  /** The active tab when it is a WebSocket or event stream. */
  readonly activeRealtime = computed<RealtimeTab | null>(() => {
    const tab = this.activeTab();
    return tab.kind === 'http' ? null : tab;
  });
  readonly hasUnsavedChanges = computed(() => this.tabs().some((tab) => tab.dirty()));

  // The active HTTP tab's state, for the editor and response panels.
  private readonly http = computed(() => this.activeRequest() ?? this.idleHttpTab);
  readonly draft = computed(() => this.http().draft());
  readonly state = computed<ExecutionState>(() => this.http().state());
  readonly files = computed(() => this.http().files());
  readonly uploadProgress = computed(() => this.http().uploadProgress());

  // --- Tabs ---

  /** Opens an empty request (or a new WebSocket / event stream connection) in a new tab. */
  newTab(): RequestTab;
  newTab(kind: RealtimeKind): RealtimeTab;
  newTab(kind?: RealtimeKind): SessionTab {
    return this.addTab(kind === undefined ? this.createTab() : this.createRealtimeTab(kind));
  }

  activate(id: string): void {
    if (this.tabs().some((tab) => tab.id === id)) this.activeIdState.set(id);
  }

  /** Shows a saved request, reusing its tab when it is already open. */
  openSaved(id: string): void {
    const open = this.requestTabs().find((tab) => tab.savedRequestId() === id);
    if (open) return this.activate(open.id);
    const saved = this.store.find(id);
    if (!saved) return;
    this.addTab(this.createTab({ draft: saved.definition, savedRequestId: id }), this.pristineActiveId());
  }

  /** Opens a request definition (for example from history) as a new unsaved tab. */
  openDraft(definition: RequestDefinition): void {
    this.addTab(this.createTab({ draft: definition }), this.pristineActiveId());
  }

  /** Opens an unsaved copy of a tab right after it. Selected files are carried over. */
  duplicateTab(id: string): void {
    const source = this.tabs().find((tab) => tab.id === id);
    if (!source) return;
    if (source.kind === 'http') {
      this.addTab(this.createTab({ draft: source.draft(), files: source.files() }), undefined, source.id);
    } else {
      const copy = this.createRealtimeTab(source.kind);
      copy.url.set(source.url());
      copy.protocols.set(source.protocols());
      copy.headers.set(source.headers());
      this.addTab(copy, undefined, source.id);
    }
  }

  /** Closes a tab, cancelling its request or connection. The last tab is replaced by an empty one. */
  closeTab(id: string): void {
    const tabs = this.tabs();
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    tabs[index].dispose();
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const fresh = this.createTab();
      this.tabsState.set([fresh]);
      this.activeIdState.set(fresh.id);
      return;
    }
    this.tabsState.set(remaining);
    if (this.activeId() === id) {
      this.activeIdState.set(remaining[Math.min(index, remaining.length - 1)].id);
    }
  }

  // --- Saving (HTTP requests only) ---

  /** Stores the tab's changes. An unsaved tab needs a location first (see `saveAs`). */
  async save(id: string): Promise<SaveOutcome> {
    const tab = this.requestTabs().find((t) => t.id === id);
    if (!tab) return 'failed';
    const savedId = tab.savedRequestId();
    if (savedId === null || !tab.isSaved()) return 'needs-location';
    return (await this.store.updateDefinition(savedId, tab.draft())) ? 'saved' : 'failed';
  }

  /** Saves the tab as a new request in the given place (creating its collection if asked), then links the tab to it. */
  async saveAs(id: string, location: SaveLocation): Promise<boolean> {
    const tab = this.requestTabs().find((t) => t.id === id);
    if (!tab) return false;
    let collectionId = location.collectionId;
    if (collectionId === null) {
      const collection = await this.collections.createCollection(location.newCollectionName ?? '');
      if (!collection) return false;
      collectionId = collection.id;
    }
    const created = await this.store.create(location.name, collectionId, location.folderId, tab.draft());
    if (!created) return false;
    tab.savedRequestId.set(created.id);
    return true;
  }

  // --- Editing the active HTTP tab ---

  setMethod(method: string): void {
    this.http().setMethod(method);
  }
  setUrl(url: string): void {
    this.http().setUrl(url);
  }
  setParams(params: readonly KeyValue[]): void {
    this.http().setParams(params);
  }
  setHeaders(headers: readonly KeyValue[]): void {
    this.http().setHeaders(headers);
  }
  setAuth(auth: AuthConfig): void {
    this.http().setAuth(auth);
  }
  setBodyKind(kind: BodyKind): void {
    this.http().setBodyKind(kind);
  }
  setBodyText(content: string): void {
    this.http().setBodyText(content);
  }
  setGraphql(changes: Partial<{ query: string; variables: string; operationName: string }>): void {
    this.http().setGraphql(changes);
  }
  setUrlencoded(fields: readonly KeyValue[]): void {
    this.http().setUrlencoded(fields);
  }
  setMultipart(fields: readonly FormDataField[]): void {
    this.http().setMultipart(fields);
  }
  addMultipartText(): void {
    this.http().addMultipartText();
  }
  addMultipartFiles(files: readonly File[], key?: string): void {
    this.http().addMultipartFiles(files, key);
  }
  updateMultipartField(id: string, changes: Partial<Pick<FormDataField, 'key' | 'value' | 'enabled' | 'kind'>>): void {
    this.http().updateMultipartField(id, changes);
  }
  removeMultipartField(id: string): void {
    this.http().removeMultipartField(id);
  }
  attachMultipartFile(id: string, file: File): void {
    this.http().attachMultipartFile(id, file);
  }
  setBinaryFile(file: File | null): void {
    this.http().setBinaryFile(file);
  }
  setAssertions(assertions: readonly Assertion[]): void {
    this.http().setAssertions(assertions);
  }
  setExtractions(extractions: readonly Extraction[]): void {
    this.http().setExtractions(extractions);
  }
  setScripts(scripts: RequestScripts): void {
    this.http().setScripts(scripts);
  }
  send(): Promise<void> {
    return this.http().send();
  }
  cancel(): void {
    this.http().cancel();
  }
  clearResult(): void {
    this.http().clearResult();
  }

  // --- Internals ---

  private requestTabs(): readonly RequestTab[] {
    return this.tabs().filter((tab): tab is RequestTab => tab.kind === 'http');
  }

  /** The active tab's id when it is a pristine, never-used request tab that a new tab may replace. */
  private pristineActiveId(): string | undefined {
    const current = this.activeRequest();
    const pristine = current !== null && current.savedRequestId() === null && !current.dirty() && current.state().status === 'idle';
    return pristine ? current.id : undefined;
  }

  private createTab(init: { draft?: RequestDefinition; savedRequestId?: string; files?: ReadonlyMap<string, File> } = {}): RequestTab {
    return new RequestTab(
      {
        run: (definition, context) => this.pipeline.run(definition, context),
        variables: () => this.environments.variables(),
        lookup: (id) => this.store.find(id),
        onExecuted: (definition, result) => void this.history.record(definition, result),
      },
      init,
    );
  }

  private createRealtimeTab(kind: RealtimeKind): RealtimeTab {
    return new RealtimeTab(kind, {
      variables: () => this.environments.variables(),
      fetch: this.fetchImpl,
      websocket: this.websocketFactory,
    });
  }

  /** Adds a tab (replacing one, or right after another) and makes it active. */
  private addTab<T extends SessionTab>(tab: T, replaceId?: string, afterId?: string): T {
    this.tabsState.update((tabs) => {
      if (replaceId !== undefined) return tabs.map((t) => (t.id === replaceId ? tab : t));
      const at = afterId === undefined ? tabs.length : tabs.findIndex((t) => t.id === afterId) + 1;
      return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
    });
    this.activeIdState.set(tab.id);
    return tab;
  }
}
