import { Injectable, inject, signal } from '@angular/core';
import {
  AuthConfig,
  ExecutionResult,
  FileReference,
  FormDataField,
  KeyValue,
  RequestBody,
  RequestDefinition,
  TextBodyLanguage,
  UploadProgress,
} from '../models';
import { newId } from '../utils/id';
import { createEmptyRequest } from '../utils/request-factory';
import { BINARY_FILE_KEY } from '../utils/request-preparation.util';
import { buildUrl, paramsFromUrl } from '../utils/url.util';
import { EnvironmentStore } from './environment-store.service';
import { RequestExecutionService } from './request-execution.service';

export type ExecutionState =
  | { readonly status: 'idle' }
  | { readonly status: 'sending' }
  | { readonly status: 'done'; readonly result: ExecutionResult };

/** Body choices offered in the editor. */
export type BodyKind = 'none' | TextBodyLanguage | 'urlencoded' | 'multipart' | 'binary';

export function fileReference(file: File): FileReference {
  return { name: file.name, size: file.size, mimeType: file.type };
}

/**
 * State of the request being edited and its latest execution. Holds the
 * business logic so components only bind to signals and forward events.
 * Becomes per-tab state when multiple tabs arrive (Milestone 3).
 */
@Injectable({ providedIn: 'root' })
export class RequestSession {
  private readonly executor = inject(RequestExecutionService);
  private readonly environments = inject(EnvironmentStore);
  private controller: AbortController | null = null;

  /** Content of body types that are switched off, so switching back restores it. */
  private memory = {
    text: '',
    urlencoded: [] as readonly KeyValue[],
    multipart: [] as readonly FormDataField[],
    binary: undefined as FileReference | undefined,
  };

  readonly draft = signal<RequestDefinition>(createEmptyRequest());
  readonly state = signal<ExecutionState>({ status: 'idle' });
  /**
   * Selected files by multipart row id (or the binary key). They live in memory
   * only: the browser does not let the app reopen a file later, so saved
   * requests keep just the file name, size and type.
   */
  readonly files = signal<ReadonlyMap<string, File>>(new Map());
  readonly uploadProgress = signal<UploadProgress | null>(null);

  setMethod(method: string): void {
    this.draft.update((draft) => ({ ...draft, method }));
  }

  /** Edits the URL text and keeps the parameter table in sync with its query. */
  setUrl(url: string): void {
    this.draft.update((draft) => ({ ...draft, url, params: paramsFromUrl(url, draft.params) }));
  }

  /** Edits the parameter table and rewrites the URL query to match. */
  setParams(params: readonly KeyValue[]): void {
    this.draft.update((draft) => ({ ...draft, params, url: buildUrl(draft.url, params) }));
  }

  setHeaders(headers: readonly KeyValue[]): void {
    this.draft.update((draft) => ({ ...draft, headers }));
  }

  setAuth(auth: AuthConfig): void {
    this.draft.update((draft) => ({ ...draft, auth }));
  }

  // --- Body ---

  /** Switches the body type, remembering what the previous type contained. */
  setBodyKind(kind: BodyKind): void {
    this.remember(this.draft().body);
    switch (kind) {
      case 'none':
        return this.setBody({ type: 'none' });
      case 'urlencoded':
        return this.setBody({ type: 'urlencoded', fields: this.memory.urlencoded });
      case 'multipart':
        return this.setBody({ type: 'multipart', fields: this.memory.multipart });
      case 'binary':
        return this.setBody({ type: 'binary', file: this.memory.binary });
      default:
        return this.setBody({ type: 'text', language: kind, content: this.memory.text });
    }
  }

  setBodyText(content: string): void {
    const body = this.draft().body;
    if (body.type === 'text') {
      this.setBody({ ...body, content });
    }
  }

  setUrlencoded(fields: readonly KeyValue[]): void {
    this.setBody({ type: 'urlencoded', fields });
  }

  setMultipart(fields: readonly FormDataField[]): void {
    this.setBody({ type: 'multipart', fields });
    this.dropUnusedFiles(fields);
  }

  addMultipartText(): void {
    this.setMultipart([...this.multipartFields(), this.newField('text')]);
  }

  /** Adds one file row per file. Several rows may share a field name. */
  addMultipartFiles(files: readonly File[], key = 'file'): void {
    const rows = files.map((file): FormDataField => ({ ...this.newField('file'), key, file: fileReference(file) }));
    this.files.update((map) => new Map([...map, ...rows.map((row, i): [string, File] => [row.id, files[i]])]));
    this.setMultipart([...this.multipartFields(), ...rows]);
  }

  updateMultipartField(id: string, changes: Partial<Pick<FormDataField, 'key' | 'value' | 'enabled' | 'kind'>>): void {
    this.setMultipart(this.multipartFields().map((field) => (field.id === id ? { ...field, ...changes } : field)));
  }

  removeMultipartField(id: string): void {
    this.setMultipart(this.multipartFields().filter((field) => field.id !== id));
  }

  /** Replaces the file of an existing row. */
  attachMultipartFile(id: string, file: File): void {
    this.files.update((map) => new Map(map).set(id, file));
    this.setMultipart(this.multipartFields().map((f) => (f.id === id ? { ...f, kind: 'file', file: fileReference(file) } : f)));
  }

  setBinaryFile(file: File | null): void {
    this.files.update((map) => {
      const next = new Map(map);
      if (file) next.set(BINARY_FILE_KEY, file);
      else next.delete(BINARY_FILE_KEY);
      return next;
    });
    this.setBody({ type: 'binary', file: file ? fileReference(file) : undefined });
  }

  // --- Execution ---

  async send(): Promise<void> {
    if (this.state().status === 'sending') {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.uploadProgress.set(null);
    this.state.set({ status: 'sending' });

    const result = await this.executor.execute(this.draft(), {
      variables: this.environments.variables(),
      files: this.files(),
      signal: controller.signal,
      onUploadProgress: (progress) => {
        if (this.controller === controller) this.uploadProgress.set(progress);
      },
    });

    if (this.controller === controller) {
      this.controller = null;
      this.uploadProgress.set(null);
      this.state.set({ status: 'done', result });
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  clearResult(): void {
    this.state.set({ status: 'idle' });
  }

  // --- Internals ---

  private setBody(body: RequestBody): void {
    this.draft.update((draft) => ({ ...draft, body }));
  }

  private multipartFields(): readonly FormDataField[] {
    const body = this.draft().body;
    return body.type === 'multipart' ? body.fields : [];
  }

  private newField(kind: 'text' | 'file'): FormDataField {
    return { id: newId(), key: '', kind, value: '', enabled: true };
  }

  private remember(body: RequestBody): void {
    switch (body.type) {
      case 'text':
        this.memory = { ...this.memory, text: body.content };
        break;
      case 'urlencoded':
        this.memory = { ...this.memory, urlencoded: body.fields };
        break;
      case 'multipart':
        this.memory = { ...this.memory, multipart: body.fields };
        break;
      case 'binary':
        this.memory = { ...this.memory, binary: body.file };
        break;
      case 'none':
        break;
    }
  }

  /** Releases File objects of removed multipart rows (the binary file is kept separately). */
  private dropUnusedFiles(fields: readonly FormDataField[]): void {
    const keep = new Set<string>([BINARY_FILE_KEY, ...fields.map((f) => f.id), ...this.memory.multipart.map((f) => f.id)]);
    const current = this.files();
    if ([...current.keys()].some((id) => !keep.has(id))) {
      this.files.set(new Map([...current].filter(([id]) => keep.has(id))));
    }
  }
}
