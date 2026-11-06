// A small API used only by the end-to-end tests. It plays several roles: a JSON/HTML/image/binary API,
// an echo for uploads, an OAuth 2.0 provider that really verifies PKCE, a GraphQL echo, a Server-Sent
// Events stream, a WebSocket echo, and a trap for requests a script should never be able to make.
import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 4400);
const hits = [];
const oauth = { codes: new Map(), tokens: 0, log: [] };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Deliberately sends no CORS headers, so browsers block the response.
  if (url.pathname === '/nocors') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"hidden":true}');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  // The wildcard does not cover Authorization, so answer a preflight with exactly the headers it asked for.
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Token, X-Request-Id');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  hits.push(url.pathname);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const body = raw.toString('utf8');
  const json = (obj, status = 200, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
  };

  const status = /^\/status\/(\d{3})$/.exec(url.pathname);
  if (status) return json({ status: Number(status[1]) }, Number(status[1]));
  const me = /^\/me\/(.+)$/.exec(url.pathname);
  if (me) return json({ session: me[1] });

  switch (url.pathname) {
    case '/hits': return json(hits);
    case '/oauth-log': return json(oauth.log);
    case '/json': return json({ name: 'api', nested: { a: [1, 2, { deep: true }], s: 'x"y' }, list: Array.from({ length: 250 }, (_, i) => i) }, 200, { 'x-request-id': 'req-1' });
    case '/echo': return json({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    case '/slow': await new Promise((r) => setTimeout(r, 4000)); return json({ slow: true });
    case '/html':
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<h1 id="t">Hello preview</h1><script>fetch("http://localhost:4400/beacon-script")</script><img src="http://localhost:4400/beacon-img"><style>h1{color:red}</style>');
    case '/png': res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG);
    case '/svg': res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="blue"/></svg>');
    case '/bin': res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="data.bin"' }); return res.end(Buffer.from([0, 1, 2, 3, 255]));
    case '/big': res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('a'.repeat(12 * 1024 * 1024));
    case '/cookies': res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=1; Path=/' }); return res.end('{"ok":true}');
    case '/upload': {
      // Reports what a multipart or binary upload contained, without storing it.
      const type = req.headers['content-type'] ?? '';
      const boundary = /boundary=(.+)$/.exec(type)?.[1];
      const parts = boundary
        ? body.split(`--${boundary}`).flatMap((part) => {
            const name = /name="([^"]*)"/.exec(part)?.[1];
            if (name === undefined) return [];
            const filename = /filename="([^"]*)"/.exec(part)?.[1];
            const value = part.split('\r\n\r\n')[1]?.replace(/\r\n$/, '') ?? '';
            return [{ name, filename: filename ?? null, size: Buffer.byteLength(value), value: filename ? undefined : value }];
          })
        : [];
      return json({ contentType: type.split(';')[0], size: raw.length, parts });
    }
    case '/login-data': return json({ session: 's-42', user: { id: 7 } }, 200, { 'x-token': 'tok-1' });
    case '/echo-headers': return json({ headers: req.headers });
    case '/ping': return json({ ok: true });
    case '/graphql': return json({ data: { received: JSON.parse(body || '{}'), contentType: req.headers['content-type'] } });
    case '/oauth/authorize': {
      const p = url.searchParams;
      const code = `code-${crypto.randomBytes(6).toString('hex')}`;
      oauth.codes.set(code, { challenge: p.get('code_challenge'), redirect: p.get('redirect_uri') });
      oauth.log.push({ step: 'authorize', responseType: p.get('response_type'), method: p.get('code_challenge_method'), hasSecret: p.has('client_secret'), scope: p.get('scope') });
      const target = new URL(p.get('redirect_uri'));
      target.searchParams.set('code', code);
      target.searchParams.set('state', p.get('state'));
      res.writeHead(302, { location: target.href });
      return res.end();
    }
    case '/oauth/token': {
      const f = new URLSearchParams(body);
      if (f.get('grant_type') === 'authorization_code') {
        const saved = oauth.codes.get(f.get('code'));
        const verified = !!saved && b64url(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) === saved.challenge;
        oauth.log.push({ step: 'token', pkceVerified: verified, hasSecret: f.has('client_secret'), redirectMatches: !!saved && saved.redirect === f.get('redirect_uri') });
        if (!verified) return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
        oauth.codes.delete(f.get('code'));
      }
      return json({ access_token: `at-${++oauth.tokens}`, token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-1', scope: 'read' });
    }
    case '/protected': {
      const auth = req.headers.authorization || '';
      return /^Bearer at-\d+$/.test(auth) ? json({ ok: true, auth }) : json({ error: 'unauthorized' }, 401);
    }
    case '/sse':
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': hello\n\n');
      res.write(`id: 1\ndata: key=${req.headers['x-stream-key'] ?? 'none'}\n\n`);
      await new Promise((r) => setTimeout(r, 100));
      res.write('id: 2\nevent: price\ndata: {"price": 10}\n\n');
      await new Promise((r) => setTimeout(r, 100));
      res.write('id: 3\ndata: line1\ndata: line2\n\n');
      return res.end();
    default:
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
  }
});

// A minimal WebSocket echo server (RFC 6455, text frames only), to avoid a dependency.
const frame = (text) => {
  const payload = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
};
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') return socket.destroy();
  const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.write(frame('welcome'));
  socket.on('data', (buf) => {
    if ((buf[0] & 0x0f) === 8) return void socket.end(Buffer.from([0x88, 0x00]));
    const length = buf[1] & 0x7f;
    const mask = buf.subarray(2, 6);
    const data = Buffer.from(buf.subarray(6, 6 + length).map((b, i) => b ^ mask[i % 4]));
    socket.write(frame(`echo: ${data.toString()}`));
  });
  socket.on('error', () => {});
});

server.listen(PORT, () => console.log(`mock API listening on ${PORT}`));
