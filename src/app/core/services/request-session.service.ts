import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthConfig, FormDataField, KeyValue, RequestDefinition } from '../models';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { RequestExecutionService } from './request-execution.service';
import { BodyKind, ExecutionState, RequestTab, fileReference } from './request-tab';
import { SavedRequestStore } from './saved-request-store.service';

export { fileReference };
export type { BodyKind, ExecutionState };

export type SaveOutcome = 'saved' | 'needs-location' | 'failed';

export interface SaveLocation {
  readonly name: string;
  /** Null when `newCollectionName` names a collection to create for it. */
  readonly collectionId: string | null;
  readonly newCollectionName?: string | null;
  readonly folderId: string | null;
}

/**
 * The open request tabs. The editing methods act on the active tab, so the
 * editor components bind to one object whichever tab is showing. Switching tabs
 * never discards a tab's unsaved edits, selected files or last response.
 */
@Injectable({ providedIn: 'root' })
export class RequestSession {
  private readonly executor = inject(RequestExecutionService);
  private readonly environments = inject(EnvironmentStore);
  private readonly store = inject(SavedRequestStore);
  private readonly collections = inject(CollectionStore);

  private readonly tabsState = signal<readonly RequestTab[]>([this.createTab()]);
  private readonly activeIdState = signal(this.tabsState()[0].id);

  readonly tabs = this.tabsState.asReadonly();
  readonly activeId = this.activeIdState.asReadonly();
  readonly activeTab = computed(() => this.tabs().find((tab) => tab.id === this.activeId()) ?? this.tabs()[0]);
  readonly hasUnsavedChanges = computed(() => this.tabs().some((tab) => tab.dirty()));

  // The active tab's state, for the editor and response panels.
  readonly draft = computed(() => this.activeTab().draft());
  readonly state = computed<ExecutionState>(() => this.activeTab().state());
  readonly files = computed(() => this.activeTab().files());
  readonly uploadProgress = computed(() => this.activeTab().uploadProgress());

  // --- Tabs ---

  /** Opens an empty request in a new tab. */
  newTab(): RequestTab {
    return this.addTab(this.createTab());
  }

  activate(id: string): void {
    if (this.tabs().some((tab) => tab.id === id)) this.activeIdState.set(id);
  }

  /** Shows a saved request, reusing its tab when it is already open. */
  openSaved(id: string): void {
    const open = this.tabs().find((tab) => tab.savedRequestId() === id);
    if (open) return this.activate(open.id);
    const saved = this.store.find(id);
    if (!saved) return;
    const tab = this.createTab({ draft: saved.definition, savedRequestId: id });
    const current = this.activeTab();
    // A pristine, never-used tab is replaced instead of piling up beside the new one.
    const replace = current.savedRequestId() === null && !current.dirty() && current.state().status === 'idle';
    this.addTab(tab, replace ? current.id : undefined);
  }

  /** Opens an unsaved copy of a tab right after it. Selected files are carried over. */
  duplicateTab(id: string): void {
    const source = this.tabs().find((tab) => tab.id === id);
    if (!source) return;
    this.addTab(this.createTab({ draft: source.draft(), files: source.files() }), undefined, source.id);
  }

  /** Closes a tab, cancelling its request. The last tab is replaced by an empty one. */
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

  // --- Saving ---

  /** Stores the tab's changes. An unsaved tab needs a location first (see `saveAs`). */
  async save(id: string): Promise<SaveOutcome> {
    const tab = this.tabs().find((t) => t.id === id);
    if (!tab) return 'failed';
    const savedId = tab.savedRequestId();
    if (savedId === null || !tab.isSaved()) return 'needs-location';
    return (await this.store.updateDefinition(savedId, tab.draft())) ? 'saved' : 'failed';
  }

  /** Saves the tab as a new request in the given place (creating its collection if asked), then links the tab to it. */
  async saveAs(id: string, location: SaveLocation): Promise<boolean> {
    const tab = this.tabs().find((t) => t.id === id);
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

  // --- Editing the active tab ---

  setMethod(method: string): void {
    this.activeTab().setMethod(method);
  }
  setUrl(url: string): void {
    this.activeTab().setUrl(url);
  }
  setParams(params: readonly KeyValue[]): void {
    this.activeTab().setParams(params);
  }
  setHeaders(headers: readonly KeyValue[]): void {
    this.activeTab().setHeaders(headers);
  }
  setAuth(auth: AuthConfig): void {
    this.activeTab().setAuth(auth);
  }
  setBodyKind(kind: BodyKind): void {
    this.activeTab().setBodyKind(kind);
  }
  setBodyText(content: string): void {
    this.activeTab().setBodyText(content);
  }
  setUrlencoded(fields: readonly KeyValue[]): void {
    this.activeTab().setUrlencoded(fields);
  }
  setMultipart(fields: readonly FormDataField[]): void {
    this.activeTab().setMultipart(fields);
  }
  addMultipartText(): void {
    this.activeTab().addMultipartText();
  }
  addMultipartFiles(files: readonly File[], key?: string): void {
    this.activeTab().addMultipartFiles(files, key);
  }
  updateMultipartField(id: string, changes: Partial<Pick<FormDataField, 'key' | 'value' | 'enabled' | 'kind'>>): void {
    this.activeTab().updateMultipartField(id, changes);
  }
  removeMultipartField(id: string): void {
    this.activeTab().removeMultipartField(id);
  }
  attachMultipartFile(id: string, file: File): void {
    this.activeTab().attachMultipartFile(id, file);
  }
  setBinaryFile(file: File | null): void {
    this.activeTab().setBinaryFile(file);
  }
  send(): Promise<void> {
    return this.activeTab().send();
  }
  cancel(): void {
    this.activeTab().cancel();
  }
  clearResult(): void {
    this.activeTab().clearResult();
  }

  // --- Internals ---

  private createTab(init: { draft?: RequestDefinition; savedRequestId?: string; files?: ReadonlyMap<string, File> } = {}): RequestTab {
    return new RequestTab(
      {
        executor: this.executor,
        variables: () => this.environments.variables(),
        lookup: (id) => this.store.find(id),
      },
      init,
    );
  }

  /** Adds a tab (replacing one, or right after another) and makes it active. */
  private addTab(tab: RequestTab, replaceId?: string, afterId?: string): RequestTab {
    this.tabsState.update((tabs) => {
      if (replaceId !== undefined) return tabs.map((t) => (t.id === replaceId ? tab : t));
      const at = afterId === undefined ? tabs.length : tabs.findIndex((t) => t.id === afterId) + 1;
      return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
    });
    this.activeIdState.set(tab.id);
    return tab;
  }
}
