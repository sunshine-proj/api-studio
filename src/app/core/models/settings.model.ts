import { PersistedEntity } from './common.model';
import { DEFAULT_REQUEST_OPTIONS, RequestOptions } from './request.model';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface AppSettings extends PersistedEntity {
  readonly theme: ThemePreference;
  readonly defaultRequestOptions: RequestOptions;
  /** Maximum response body size rendered in the editor, in bytes. */
  readonly maxRenderedResponseBytes: number;
  readonly historyLimit: number;
  readonly activeEnvironmentId: string | null;
}

export const DEFAULT_SETTINGS_VALUES = {
  theme: 'system',
  defaultRequestOptions: DEFAULT_REQUEST_OPTIONS,
  maxRenderedResponseBytes: 10 * 1024 * 1024,
  historyLimit: 100,
  activeEnvironmentId: null,
} as const satisfies Omit<AppSettings, keyof PersistedEntity>;
