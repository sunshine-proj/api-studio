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
  | { readonly type: 'custom'; readonly headerName: string; readonly headerValue: string }
  /**
   * OAuth 2.0 Authorization Code with PKCE. There is deliberately no client
   * secret field: a browser app is a public client and cannot keep one. The
   * access token itself is never stored in the request (see OAuthTokenStore).
   */
  | {
      readonly type: 'oauth2';
      readonly authorizationUrl: string;
      readonly tokenUrl: string;
      readonly clientId: string;
      readonly scope: string;
    };

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
  | { readonly type: 'binary'; readonly file?: FileReference }
  /** Sent as a JSON `{ query, variables, operationName }` document. `variables` is JSON text. */
  | {
      readonly type: 'graphql';
      readonly query: string;
      readonly variables: string;
      readonly operationName: string;
    };

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

export type AssertionTarget = 'status' | 'header' | 'json' | 'body' | 'duration';

export type AssertionOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'not-contains'
  | 'matches'
  | 'exists'
  | 'not-exists'
  | 'less-than'
  | 'greater-than';

/** A check run against the response after a request is sent. */
export interface Assertion {
  readonly id: string;
  readonly enabled: boolean;
  readonly target: AssertionTarget;
  /** Header name or JSON path; unused for the other targets. */
  readonly property: string;
  readonly operator: AssertionOperator;
  readonly expected: string;
}

export type ExtractionSource = 'json' | 'header' | 'status' | 'regex';

/** Copies a value out of the response into an environment variable, so later requests can use it (chaining). */
export interface Extraction {
  readonly id: string;
  readonly enabled: boolean;
  readonly variable: string;
  readonly source: ExtractionSource;
  /** JSON path, header name, or a regular expression (its first group, or the whole match). */
  readonly expression: string;
  /** Mark the variable secret when this creates it. */
  readonly secret: boolean;
}

/**
 * Scripts run in an isolated sandbox with no network or page access (see
 * ScriptSandbox). They only run when `enabled` is true, and imported requests
 * always arrive with it off.
 */
export interface RequestScripts {
  readonly enabled: boolean;
  readonly preRequest: string;
  readonly test: string;
}

/** Execution-independent request definition (no browser types). */
export interface RequestDefinition {
  readonly method: HttpMethod;
  readonly url: string;
  readonly params: readonly KeyValue[];
  readonly headers: readonly KeyValue[];
  readonly auth: AuthConfig;
  readonly body: RequestBody;
  readonly options: RequestOptions;
  readonly assertions?: readonly Assertion[];
  readonly extractions?: readonly Extraction[];
  readonly scripts?: RequestScripts;
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
