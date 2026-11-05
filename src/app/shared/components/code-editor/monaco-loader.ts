import type * as Monaco from 'monaco-editor';

export type MonacoApi = typeof Monaco;

interface AmdRequire {
  (modules: string[], onLoad: () => void, onError: (error: unknown) => void): void;
  config(options: { paths: Record<string, string> }): void;
}

declare global {
  interface Window {
    require?: AmdRequire;
    monaco?: MonacoApi;
  }
}

let loading: Promise<MonacoApi> | undefined;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = (): void => resolve();
    script.onerror = (): void => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads Monaco on first use from the self-hosted copy under /monaco/vs, so it
 * never ends up in the initial bundle. Subsequent calls share one promise.
 */
export function loadMonaco(): Promise<MonacoApi> {
  loading ??= (async (): Promise<MonacoApi> => {
    const base = new URL('monaco/vs', document.baseURI).href;
    await loadScript(`${base}/loader.js`);
    const amdRequire = window.require;
    if (!amdRequire) {
      throw new Error('The Monaco loader did not initialize.');
    }
    amdRequire.config({ paths: { vs: base } });
    await new Promise<void>((resolve, reject) => amdRequire(['vs/editor/editor.main'], resolve, reject));
    if (!window.monaco) {
      throw new Error('Monaco did not initialize.');
    }
    return window.monaco;
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
