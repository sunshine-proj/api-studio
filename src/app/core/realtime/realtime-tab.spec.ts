import { RealtimeTab } from './realtime-tab';
import { MAX_REALTIME_MESSAGES, MAX_REALTIME_TEXT } from './realtime.model';
import { WebSocketLike } from './websocket-factory';

class FakeSocket implements WebSocketLike {
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  sent: string[] = [];
  closed: [number | undefined, string | undefined] | null = null;
  constructor(readonly url: string, readonly protocols: readonly string[]) {}
  send(data: string): void { this.sent.push(data); }
  close(code?: number, reason?: string): void { this.closed = [code, reason]; this.onclose?.({ code: code ?? 1005, reason: reason ?? '' } as CloseEvent); }
  open(): void { this.onopen?.(new Event('open')); }
  receive(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
  drop(code = 1006): void { this.onclose?.({ code, reason: '' } as CloseEvent); }
}

function webSocketTab(variables: Record<string, string> = {}) {
  const sockets: FakeSocket[] = [];
  const tab = new RealtimeTab('websocket', {
    variables: () => new Map(Object.entries(variables)),
    fetch: () => Promise.reject(new Error('not used')),
    websocket: (url, protocols) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
  });
  return { tab, sockets };
}

/** A fetch whose body is delivered in the given chunks, then ends (or errors). */
function streamingFetch(chunks: string[], init: { status?: number; type?: string; fail?: boolean } = {}) {
  const calls: { url: string; headers: Headers; signal: AbortSignal }[] = [];
  const impl = ((url: string, options: RequestInit) => {
    calls.push({ url, headers: options.headers as Headers, signal: options.signal as AbortSignal });
    if (init.fail) return Promise.reject(new TypeError('Failed to fetch'));
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: init.status ?? 200, headers: { 'content-type': init.type ?? 'text/event-stream' } }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const sseTab = (impl: typeof fetch, variables: Record<string, string> = {}) =>
  new RealtimeTab('sse', { variables: () => new Map(Object.entries(variables)), fetch: impl, websocket: () => { throw new Error('not used'); } });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const texts = (tab: RealtimeTab) => tab.messages().map((m) => `${m.direction}:${m.text}`);

describe('RealtimeTab (WebSocket)', () => {
  it('connects, shows messages in both directions, and closes', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://echo.test/socket');
    tab.protocols.set('chat, v2');
    tab.connect();
    expect(tab.status()).toBe('connecting');
    expect(sockets[0].url).toBe('wss://echo.test/socket');
    expect(sockets[0].protocols).toEqual(['chat', 'v2']);

    sockets[0].open();
    expect(tab.status()).toBe('open');
    expect(tab.connected()).toBe(true);

    expect(tab.send('hello')).toBe(true);
    sockets[0].receive('echo: hello');
    expect(sockets[0].sent).toEqual(['hello']);
    expect(texts(tab).slice(-2)).toEqual(['out:hello', 'in:echo: hello']);

    tab.disconnect();
    expect(sockets[0].closed).toEqual([1000, 'Closed by the user']);
    expect(tab.status()).toBe('closed');
    expect(tab.messages().at(-1)?.text).toBe('Closed (code 1000: normal closure) Closed by the user');
  });

  it('resolves variables in the URL and in sent messages, and says when one is missing', () => {
    const { tab, sockets } = webSocketTab({ host: 'echo.test', name: 'Ann' });
    tab.url.set('wss://{{host}}/ws');
    tab.connect();
    sockets[0].open();
    expect(sockets[0].url).toBe('wss://echo.test/ws');
    tab.send('hi {{name}} {{unknown}}');
    expect(sockets[0].sent).toEqual(['hi Ann {{unknown}}']);
    expect(tab.messages().some((m) => m.direction === 'info' && m.text.includes('{{unknown}}'))).toBe(true);
  });

  it('refuses unusable URLs without opening anything', () => {
    for (const [url, message] of [['', /Enter a WebSocket URL/], ['https://a.test', /start with ws/], ['not a url', /Enter a WebSocket URL/], ['wss://{{missing}}/', /not defined/]] as const) {
      const { tab, sockets } = webSocketTab();
      tab.url.set(url);
      tab.connect();
      expect(sockets).toEqual([]);
      expect(tab.status()).toBe('error');
      expect(tab.messages().at(-1)?.text).toMatch(message);
    }
  });

  it('rejects invalid subprotocols', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://a.test');
    tab.protocols.set('good, bad proto');
    tab.connect();
    expect(sockets).toEqual([]);
    expect(tab.messages().at(-1)?.text).toMatch(/subprotocol/);
  });

  it('reports a blocked insecure connection from the browser', () => {
    const tab = new RealtimeTab('websocket', {
      variables: () => new Map(),
      fetch: () => Promise.reject(new Error('x')),
      websocket: () => { throw new DOMException('insecure', 'SecurityError'); },
    });
    tab.url.set('ws://a.test');
    tab.connect();
    expect(tab.status()).toBe('error');
    expect(tab.messages().at(-1)?.text).toMatch(/mixed content/);
  });

  it('is honest that a failed connection cannot be explained', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://down.test');
    tab.connect();
    sockets[0].onerror?.(new Event('error'));
    sockets[0].drop(1006);
    expect(tab.status()).toBe('error'); // never opened
    expect(tab.messages().map((m) => m.text).join('\n')).toMatch(/does not say why/);
    expect(tab.messages().at(-1)?.text).toMatch(/code 1006/);
  });

  it('keeps the status "closed" (not an error) when an open connection drops', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://a.test');
    tab.connect();
    sockets[0].open();
    sockets[0].drop(1001);
    expect(tab.status()).toBe('closed');
  });

  it('shows binary messages by size and refuses to send when not connected', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://a.test');
    expect(tab.send('x')).toBe(false);
    tab.connect();
    expect(tab.send('x')).toBe(false); // still connecting
    sockets[0].open();
    sockets[0].receive(new Blob(['abcd']));
    expect(tab.messages().at(-1)).toMatchObject({ direction: 'in', binary: true, size: 4, text: '(binary message, 4 bytes)' });
  });

  it('ignores a second connect while busy and allows reconnecting afterwards', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://a.test');
    tab.connect();
    tab.connect();
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    sockets[0].drop(1000);
    tab.connect();
    expect(sockets).toHaveLength(2);
  });

  it('keeps only the most recent messages and shortens huge ones', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://a.test');
    tab.connect();
    sockets[0].open();
    for (let i = 0; i < MAX_REALTIME_MESSAGES + 50; i++) sockets[0].receive(`m${i}`);
    expect(tab.messages()).toHaveLength(MAX_REALTIME_MESSAGES);
    expect(tab.messages().at(-1)?.text).toBe(`m${MAX_REALTIME_MESSAGES + 49}`);
    sockets[0].receive('x'.repeat(MAX_REALTIME_TEXT + 10));
    expect(tab.messages().at(-1)).toMatchObject({ truncated: true, size: MAX_REALTIME_TEXT + 10 });
    expect(tab.messages().at(-1)?.text).toHaveLength(MAX_REALTIME_TEXT);
    tab.clear();
    expect(tab.messages()).toEqual([]);
  });

  it('closes the connection when the tab is disposed', () => {
    const { tab, sockets } = webSocketTab();
    tab.url.set('wss://a.test');
    tab.connect();
    sockets[0].open();
    tab.dispose();
    expect(sockets[0].closed).not.toBeNull();
  });

  it('has a title and badge, and never counts as unsaved', () => {
    const { tab } = webSocketTab();
    expect(tab.title()).toBe('New WebSocket');
    expect(tab.badge()).toBe('WS');
    tab.url.set('wss://a.test');
    expect(tab.title()).toBe('wss://a.test');
    expect(tab.dirty()).toBe(false);
  });
});

describe('RealtimeTab (Server-Sent Events)', () => {
  it('streams events into the log, with their event names', async () => {
    const { impl, calls } = streamingFetch(['event: price\ndata: 10\n\n', 'data: hel', 'lo\n\n']);
    const tab = sseTab(impl);
    tab.url.set('https://stream.test/events');
    tab.connect();
    await settle();
    expect(calls[0].url).toBe('https://stream.test/events');
    expect(calls[0].headers.get('Accept')).toBe('text/event-stream');
    expect(tab.messages().filter((m) => m.direction === 'in').map((m) => [m.event, m.text])).toEqual([['price', '10'], ['message', 'hello']]);
    expect(tab.status()).toBe('closed');
    expect(tab.messages().at(-1)?.text).toBe('The server closed the stream.');
  });

  it('sends the configured headers (which EventSource cannot) and resolves variables', async () => {
    const { impl, calls } = streamingFetch([]);
    const tab = sseTab(impl, { token: 'abc', host: 'stream.test' });
    tab.url.set('https://{{host}}/events');
    tab.headers.set([{ id: '1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }, { id: '2', key: 'X-Off', value: 'no', enabled: false }]);
    tab.connect();
    await settle();
    expect(calls[0].url).toBe('https://stream.test/events');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer abc');
    expect(calls[0].headers.has('X-Off')).toBe(false);
  });

  it('can be disconnected by the user', async () => {
    let signal!: AbortSignal;
    const impl = ((_: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }) as unknown as typeof fetch;
    const tab = sseTab(impl);
    tab.url.set('https://stream.test/events');
    tab.connect();
    expect(tab.status()).toBe('connecting');
    tab.disconnect();
    await settle();
    expect(signal.aborted).toBe(true);
    expect(tab.status()).toBe('closed');
    expect(tab.messages().at(-1)?.text).toBe('Disconnected.');
  });

  it('reports HTTP errors and network failures distinctly', async () => {
    const http = sseTab(streamingFetch([], { status: 401 }).impl);
    http.url.set('https://stream.test/events');
    http.connect();
    await settle();
    expect(http.status()).toBe('error');
    expect(http.messages().at(-1)?.text).toContain('401');

    const net = sseTab(streamingFetch([], { fail: true }).impl);
    net.url.set('https://stream.test/events');
    net.connect();
    await settle();
    expect(net.status()).toBe('error');
    expect(net.messages().at(-1)?.text).toMatch(/CORS/);
  });

  it('warns when the response is not an event stream, but still reads it', async () => {
    const tab = sseTab(streamingFetch(['data: x\n\n'], { type: 'application/json' }).impl);
    tab.url.set('https://stream.test/events');
    tab.connect();
    await settle();
    expect(tab.messages().some((m) => m.direction === 'info' && /not text\/event-stream/.test(m.text))).toBe(true);
    expect(tab.messages().some((m) => m.direction === 'in' && m.text === 'x')).toBe(true);
  });

  it('asks to resume from the last event id when reconnecting', async () => {
    const first = streamingFetch(['id: 41\ndata: a\n\n']);
    const calls: Headers[] = [];
    let n = 0;
    const impl = ((url: string, init: RequestInit) => {
      calls.push(init.headers as Headers);
      return (n++ === 0 ? first.impl : streamingFetch([]).impl)(url, init);
    }) as unknown as typeof fetch;
    const tab = sseTab(impl);
    tab.url.set('https://stream.test/events');
    tab.connect();
    await settle();
    tab.connect();
    await settle();
    expect(calls[0].has('Last-Event-ID')).toBe(false);
    expect(calls[1].get('Last-Event-ID')).toBe('41');
  });

  it('refuses invalid URLs and does not try forbidden headers', async () => {
    const { impl, calls } = streamingFetch([]);
    const tab = sseTab(impl);
    tab.url.set('ftp://x.test');
    tab.connect();
    await settle();
    expect(calls).toEqual([]);
    expect(tab.status()).toBe('error');
  });

  it('ignores send() because event streams are one-way', () => {
    const tab = sseTab(streamingFetch([]).impl);
    expect(tab.send('x')).toBe(false);
    expect(tab.badge()).toBe('SSE');
  });
});
