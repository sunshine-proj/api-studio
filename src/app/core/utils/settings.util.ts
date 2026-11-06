import {
  AppSettings,
  CredentialsMode,
  DEFAULT_SETTINGS_VALUES,
  RedirectMode,
  SCHEMA_VERSION,
  SETTINGS_ID,
  ThemePreference,
} from '../models';

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system'];
const REDIRECTS: readonly RedirectMode[] = ['follow', 'manual', 'error'];
const CREDENTIALS: readonly CredentialsMode[] = ['omit', 'same-origin', 'include'];

export function createDefaultSettings(now = Date.now()): AppSettings {
  return { id: SETTINGS_ID, schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, ...DEFAULT_SETTINGS_VALUES };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/** Hard bounds for user-configurable limits. The upper render bound is the most response data ever kept in memory. */
export const MIN_RENDER_BYTES = 1024;
export const MAX_RENDER_BYTES = 50 * 1024 * 1024;
export const MAX_HISTORY_LIMIT = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveNumber(value: unknown, fallback: number, allowZero = false): number {
  return typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)
    ? Math.floor(value)
    : fallback;
}

/**
 * Turns whatever was read from storage into valid settings. Unknown fields are
 * dropped and invalid or missing ones fall back to defaults, so a corrupt or
 * older record can never put the app into an unusable state.
 */
export function normalizeSettings(raw: unknown, now = Date.now()): AppSettings {
  const defaults = createDefaultSettings(now);
  if (!isRecord(raw)) return defaults;
  const options = isRecord(raw['defaultRequestOptions']) ? raw['defaultRequestOptions'] : {};
  const defaultOptions = DEFAULT_SETTINGS_VALUES.defaultRequestOptions;
  return {
    id: SETTINGS_ID,
    schemaVersion: SCHEMA_VERSION,
    createdAt: positiveNumber(raw['createdAt'], defaults.createdAt),
    updatedAt: positiveNumber(raw['updatedAt'], defaults.updatedAt),
    theme: pick(raw['theme'], THEMES, defaults.theme),
    defaultRequestOptions: {
      timeoutMs: positiveNumber(options['timeoutMs'], defaultOptions.timeoutMs, true),
      redirect: pick(options['redirect'], REDIRECTS, defaultOptions.redirect),
      credentials: pick(options['credentials'], CREDENTIALS, defaultOptions.credentials),
    },
    maxRenderedResponseBytes: clamp(
      positiveNumber(raw['maxRenderedResponseBytes'], defaults.maxRenderedResponseBytes),
      MIN_RENDER_BYTES,
      MAX_RENDER_BYTES,
    ),
    historyLimit: clamp(positiveNumber(raw['historyLimit'], defaults.historyLimit), 1, MAX_HISTORY_LIMIT),
    activeEnvironmentId: typeof raw['activeEnvironmentId'] === 'string' ? raw['activeEnvironmentId'] : null,
    storageNoticeAcknowledged: raw['storageNoticeAcknowledged'] === true,
  };
}
