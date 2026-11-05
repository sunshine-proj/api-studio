/** Current persisted model schema version. Bump when a stored shape changes. */
export const SCHEMA_VERSION = 1;

/** Fields shared by every persisted entity. */
export interface PersistedEntity {
  /** Stable UUID. */
  readonly id: string;
  readonly schemaVersion: number;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/** A name/value row with an enable switch (params, headers, form fields). */
export interface KeyValue {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly enabled: boolean;
  readonly description?: string;
}
