import { TestBed } from '@angular/core/testing';
import { RequestDefinition } from '../models';
import { createEmptyRequest } from '../utils/request-factory';
import { BrowserFetchExecutor, FETCH_IMPLEMENTATION } from './browser-fetch-executor.service';
import { BrowserXhrTransport } from './browser-xhr-transport.service';

const request = (patch: Partial<RequestDefinition> = {}): RequestDefinition => ({
  ...createEmptyRequest(),
  url: 'https://api.test/items',
  ...patch,
});
const context = { variables: new Map<string, string>() };

function create(fetchImpl: typeof fetch): BrowserFetchExecutor {
  TestBed.configureTestingModule({ providers: [{ provide: FETCH_IMPLEMENTATION, useValue: fetchImpl }] });
  return TestBed.inject(BrowserFetchExecutor);
}

describe('BrowserFetchExecutor', () => {
  it('returns a successful result with parsed response info and measured duration', async () => {
    const spy = vi.fn(async () =>
      new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    const result = await create(spy as unknown as typeof fetch).execute(request(), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.status).toBe(201);
    expect(result.response.body).toEqual({ contentType: 'application/json', size: 11, truncated: false });
    expect(result.response.durationMs).toBeGreaterThanOrEqual(0);
    expect(await result.body.text()).toBe('{"ok":true}');
    expect(result.response.cookies.available).toBe(false);
  });

  it('treats HTTP error statuses as responses, not failures', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('nope', { status: 500 });
    const result = await create(fetchImpl).execute(request(), context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.status).toBe(500);
  });

  it('sends method, headers, text body and request options', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    await create(spy as unknown as typeof fetch).execute(
      request({
        method: 'post',
        body: { type: 'text', language: 'json', content: '{"a":1}' },
        headers: [{ id: '1', key: 'X-Test', value: 'yes', enabled: true }],
      }),
      context,
    );
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/items');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual([
      ['X-Test', 'yes'],
      ['Content-Type', 'application/json'],
    ]);
    expect(init.redirect).toBe('follow');
    expect(init.credentials).toBe('omit');
  });

  it('does not call fetch for an invalid request', async () => {
    const spy = vi.fn();
    const result = await create(spy as unknown as typeof fetch).execute(request({ url: 'nope' }), context);
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-request');
      expect(result.durationMs).toBeNull();
    }
  });

  it('classifies a TypeError on a cross-origin request as possible CORS', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    const result = await create(fetchImpl).execute(request(), context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('possible-cors');
      expect(result.error.hint).toBeTruthy();
    }
  });

  it('reports user cancellation as aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const pending = create(fetchImpl).execute(request(), { ...context, signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.ok === false && result.error.kind).toBe('aborted');
  });

  it('does not send when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi.fn();
    const result = await create(spy as unknown as typeof fetch).execute(request(), { ...context, signal: controller.signal });
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok === false && result.error.kind).toBe('aborted');
  });

  it('reports a timeout distinctly from cancellation', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      const pending = create(fetchImpl).execute(
        request({ options: { ...createEmptyRequest().options, timeoutMs: 1000 } }),
        context,
      );
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;
      expect(result.ok === false && result.error.kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an empty body for HEAD requests', async () => {
    const result = await create(async () => new Response(null, { status: 200 })).execute(request({ method: 'HEAD' }), context);
    expect(result.ok && result.body.size).toBe(0);
  });

  it('sends multipart bodies as native FormData without a manual Content-Type', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    await create(spy as unknown as typeof fetch).execute(
      request({
        method: 'POST',
        body: {
          type: 'multipart',
          fields: [
            { id: 'f', key: 'doc', kind: 'file', value: '', enabled: true, file: { name: 'a.txt', size: 3, mimeType: 'text/plain' } },
          ],
        },
      }),
      { ...context, files: new Map([['f', file]]) },
    );
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('doc')).toBeInstanceOf(File);
    expect(init.headers).toEqual([]);
  });

  it('uses XHR for uploads only when progress is requested', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    const executor = create(spy as unknown as typeof fetch);
    const upload = request({ method: 'POST', body: { type: 'binary', file: { name: 'b', size: 1, mimeType: '' } } });
    const files = new Map([['binary', new Blob(['x'])]]);

    await executor.execute(upload, { ...context, files });
    expect(spy).toHaveBeenCalledTimes(1);

    const xhrSpy = vi.spyOn(TestBed.inject(BrowserXhrTransport), 'send').mockResolvedValue({
      ok: false,
      error: { kind: 'aborted', message: 'x' },
      request: null,
      durationMs: 0,
      warnings: [],
    });
    await executor.execute(upload, { ...context, files, onUploadProgress: () => undefined });
    expect(xhrSpy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);

    await executor.execute(request({ method: 'POST' }), { ...context, onUploadProgress: () => undefined });
    expect(xhrSpy).toHaveBeenCalledTimes(1);
  });
});
