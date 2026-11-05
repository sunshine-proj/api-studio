import { KeyValue, PersistedEntity } from './common.model';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | (string & {});

export type RedirectMode = 'follow' | 'manual' | 'error';
export type CredentialsMode = 'omit' | 'same-origin' | 'include';

export type AuthConfig =
  | { readonly type: 'none' }
  | { readonly type: 'basic'; readonly username: string; readonly password: string }
  | { readonly type: 'bearer'; readonly token: string }
  | {
      readonly type: 'apiKey';
      readonly key: string;
      readonly value: string;
      readonly placement: 'header' | 'query';
    }
  | { readonly type: 'custom'; readonly headerName: string; readonly headerValue: string };

/** Reference to a user-selected file. Contents are not persisted by default. */
export interface FileReference {
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
}

export interface FormDataField {
  readonly id: string;
  readonly key: string;
  readonly enabled: boolean;
  readonly kind: 'text' | 'file';
  readonly value: string;
  /** Present when kind is 'file'. Multiple files per field are separate rows. */
  readonly file?: FileReference;
}

export type TextBodyLanguage = 'json' | 'xml' | 'text' | 'javascript';

export type RequestBody =
  | { readonly type: 'none' }
  | { readonly type: 'text'; readonly language: TextBodyLanguage; readonly content: string }
  | { readonly type: 'urlencoded'; readonly fields: readonly KeyValue[] }
  | { readonly type: 'multipart'; readonly fields: readonly FormDataField[] }
  | { readonly type: 'binary'; readonly file?: FileReference };

export interface RequestOptions {
  /** Milliseconds. 0 disables the timeout. */
  readonly timeoutMs: number;
  readonly redirect: RedirectMode;
  readonly credentials: CredentialsMode;
}

export const DEFAULT_REQUEST_OPTIONS: RequestOptions = {
  timeoutMs: 30_000,
  redirect: 'follow',
  credentials: 'omit',
};

/** Execution-independent request definition (no browser types). */
export interface RequestDefinition {
  readonly method: HttpMethod;
  readonly url: string;
  readonly params: readonly KeyValue[];
  readonly headers: readonly KeyValue[];
  readonly auth: AuthConfig;
  readonly body: RequestBody;
  readonly options: RequestOptions;
}

/** A request saved in a collection. */
export interface SavedRequest extends PersistedEntity {
  readonly name: string;
  readonly collectionId: string;
  /** Folder id, or null when directly under the collection. */
  readonly folderId: string | null;
  readonly sortOrder: number;
  readonly definition: RequestDefinition;
}
