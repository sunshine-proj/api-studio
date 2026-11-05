import { TestBed } from '@angular/core/testing';
import { PreparedRequest } from '../models';
import { BrowserXhrTransport, parseHeaders } from './browser-xhr-transport.service';

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: [string, string][] = [];
  body: unknown;
  responseType = '';
  timeout = 0;
  withCredentials = false;
  status = 200;
  statusText = 'OK';
  responseURL = 'https://up.test/upload';
  response: Blob | null = new Blob(['done']);
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }
  getAllResponseHeaders(): string {
    return 'content-type: text/plain\r\nx-id: 7\r\n';
  }
  getResponseHeader(name: string): string | null {
    return name === 'content-type' ? 'text/plain' : null;
  }
  send(body: unknown): void {
    this.body = body;
  }
  abort(): void {
    this.onabort?.();
  }
}

const request: PreparedRequest = {
  method: 'POST',
  url: 'https://up.test/upload',
  headers: [{ name: 'X-A', value: '1' }],
  body: { type: 'binary', blob: new Blob(['payload']) },
  options: { timeoutMs: 5000, redirect: 'follow', credentials: 'omit' },
};

describe('BrowserXhrTransport', () => {
  let transport: BrowserXhrTransport;
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    transport = TestBed.inject(BrowserXhrTransport);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the request, reports upload progress and returns the response', async () => {
    const progress: unknown[] = [];
    const pending = transport.send(request, [], { variables: new Map(), onUploadProgress: (p) => progress.push(p) });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.responseType).toBe('blob');
    expect(xhr.timeout).toBe(5000);
    expect(xhr.headers).toEqual([['X-A', '1']]);
    expect(xhr.body).toBe(request.body.type === 'binary' ? request.body.blob : null);

    xhr.upload.onprogress?.({ loaded: 3, total: 7, lengthComputable: true } as ProgressEvent);
    xhr.upload.onprogress?.({ loaded: 7, total: 0, lengthComputable: false } as ProgressEvent);
    xhr.onload?.();
    const result = await pending;

    expect(progress).toEqual([{ loaded: 3, total: 7 }, { loaded: 7, total: null }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.status).toBe(200);
      expect(result.response.headers).toEqual([
        { name: 'content-type', value: 'text/plain' },
        { name: 'x-id', value: '7' },
      ]);
      expect(await result.body.text()).toBe('done');
    }
  });

  it('classifies timeout, network failure and cancellation distinctly', async () => {
    const timeout = transport.send(request, [], { variables: new Map() });
    FakeXhr.last.ontimeout?.();
    const t = await timeout;
    expect(!t.ok && t.error.kind).toBe('timeout');

    const network = transport.send(request, [], { variables: new Map() });
    FakeXhr.last.onerror?.();
    const n = await network;
    expect(!n.ok && n.error.kind).toBe('possible-cors');

    const controller = new AbortController();
    const cancelled = transport.send(request, [], { variables: new Map(), signal: controller.signal });
    controller.abort();
    const c = await cancelled;
    expect(!c.ok && c.error.kind).toBe('aborted');
  });

  it('warns that redirect options are ignored', async () => {
    const pending = transport.send({ ...request, options: { ...request.options, redirect: 'manual' } }, [], { variables: new Map() });
    FakeXhr.last.onload?.();
    const result = await pending;
    expect(result.warnings.join()).toContain('redirect option was ignored');
  });

  it('parses raw header blocks', () => {
    expect(parseHeaders('A: 1\r\nB:two: parts\r\n\r\n')).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: 'two: parts' },
    ]);
    expect(parseHeaders('')).toEqual([]);
  });
});
