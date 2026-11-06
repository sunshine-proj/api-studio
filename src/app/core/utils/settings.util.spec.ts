import { createDefaultSettings, normalizeSettings } from './settings.util';

describe('normalizeSettings', () => {
  it('returns defaults for missing or non-object input', () => {
    for (const raw of [undefined, null, 'x', 5]) {
      expect(normalizeSettings(raw, 1)).toEqual(createDefaultSettings(1));
    }
  });

  it('keeps valid values', () => {
    const settings = normalizeSettings({
      theme: 'dark',
      defaultRequestOptions: { timeoutMs: 0, redirect: 'manual', credentials: 'include' },
      maxRenderedResponseBytes: 2048,
      historyLimit: 5,
      activeEnvironmentId: 'env-1',
      storageNoticeAcknowledged: true,
    });
    expect(settings).toMatchObject({
      theme: 'dark',
      defaultRequestOptions: { timeoutMs: 0, redirect: 'manual', credentials: 'include' },
      maxRenderedResponseBytes: 2048,
      historyLimit: 5,
      activeEnvironmentId: 'env-1',
      storageNoticeAcknowledged: true,
    });
  });

  it('replaces invalid values with defaults and drops unknown fields', () => {
    const settings = normalizeSettings({
      theme: 'neon',
      defaultRequestOptions: { timeoutMs: -1, redirect: 'sideways', credentials: 3 },
      maxRenderedResponseBytes: 'big',
      historyLimit: 0,
      activeEnvironmentId: 7,
      storageNoticeAcknowledged: 'yes',
      __proto__: { polluted: true },
      extra: 1,
    });
    expect(settings).toEqual({ ...createDefaultSettings(), createdAt: settings.createdAt, updatedAt: settings.updatedAt });
    expect('extra' in settings).toBe(false);
  });
});
