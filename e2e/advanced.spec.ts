// OAuth 2.0 + PKCE, chaining, assertions, the collection runner, GraphQL, WebSockets, SSE and the script sandbox.
import { API, allowConsole, expandNode, expect, test, requestButton } from './support/fixtures';

const def = (url: string, over: Record<string, unknown> = {}) => ({
  method: 'GET', url, params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' },
  options: { timeoutMs: 30000, redirect: 'follow', credentials: 'omit' }, ...over,
});

const scripted = (name: string, id: string, definition: object, folderId: string | null = null) => ({
  id, collectionId: 'c', folderId, name, sortOrder: 0, definition,
});

const file = (requests: unknown[], folders: unknown[] = []) => ({
  format: 'api-studio', version: 2, collections: [{ id: 'c', name: 'Adv', sortOrder: 0 }], folders, requests, environments: [],
});

test.describe('Sandboxed scripting', () => {
  const sandboxNoise = /sandbox|Content Security Policy|CSP|violat|blocked|Refused|NetworkError|Failed to load/i;

  test('imported scripts start switched off; once enabled they run in a sandbox that has no network or page access', async ({ app, page }) => {
    allowConsole(page, sandboxNoise);
    await app.open();
    await app.importJson('s.json', file([
      scripted('scripted', 'a', def(`${API}/echo-headers`, { scripts: { enabled: true,
        preRequest: "request.headers['X-Sig'] = 'sig-1';",
        test: "test('status ok', () => assert.equal(response.status, 200));\ntest('sig sent', () => assert.equal(response.json().headers['x-sig'], 'sig-1'));\nconsole.log('from test');" } })),
      scripted('hostile', 'b', def(`${API}/ping`, { scripts: { enabled: true, test: '',
        preRequest: "try { await fetch('http://localhost:4400/exfil-fetch'); console.log('fetch-ok'); } catch (e) { console.log('fetch-blocked'); }\ntry { new WebSocket('ws://localhost:4400/ws'); console.log('ws-created'); } catch (e) { console.log('ws-blocked'); }\nconsole.log('document=' + typeof document + ' window=' + typeof window + ' localStorage=' + typeof localStorage + ' parent=' + typeof parent);" } })),
    ]));
    await expandNode(page, 'Collection', 'Adv');

    // 1. Off by default: the script does not run.
    await requestButton(page, 'scripted').click();
    await app.editorTab(/^Scripts/).click();
    const toggle = page.getByRole('checkbox', { name: 'Run these scripts when sending' });
    await expect(toggle).not.toBeChecked();
    expect(JSON.stringify((await (await app.sendTo(`${API}/echo-headers`)).json()).headers)).not.toContain('x-sig');

    // 2. Enabled: it changes the request, and its tests are reported.
    await toggle.check();
    expect((await (await app.sendTo(`${API}/echo-headers`)).json()).headers['x-sig']).toBe('sig-1');
    await app.responseTab(/^Tests/).click();
    await expect(page.getByText('2 of 2 passed')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Test results' })).toContainText('sig sent');
    await expect(page.locator('pre.logs')).toContainText('[test] from test');

    // 3. Hostile script: no network, no page.
    await requestButton(page, 'hostile').click();
    await app.editorTab(/^Scripts/).click();
    await page.getByRole('checkbox', { name: 'Run these scripts when sending' }).check();
    await app.send();
    await app.responseTab(/^Tests/).click();
    const output = page.locator('pre.logs');
    await expect(output).toContainText('fetch-blocked');
    await expect(output).toContainText('document=undefined window=undefined localStorage=undefined parent=undefined');
    await page.waitForTimeout(500);
    const hits: string[] = await (await fetch(`${API}/hits`)).json();
    expect(hits).not.toContain('/exfil-fetch');
  });

  test('a script that never ends is stopped after 5 seconds and the app stays usable', async ({ app, page }) => {
    allowConsole(page, sandboxNoise);
    await app.open();
    await app.importJson('l.json', file([scripted('loop', 'a', def(`${API}/ping`, { scripts: { enabled: true, test: '', preRequest: 'while (true) {}' } }))]));
    await expandNode(page, 'Collection', 'Adv');
    await requestButton(page, 'loop').click();
    await app.editorTab(/^Scripts/).click();
    await page.getByRole('checkbox', { name: 'Run these scripts when sending' }).check();
    const started = Date.now();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('app-response-viewer').getByRole('alert')).toContainText('took longer than 5 seconds and was stopped', { timeout: 15_000 });
    expect(Date.now() - started).toBeGreaterThan(4500);
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});

test.describe('Chaining, assertions and the collection runner', () => {
  const chain = file(
    [
      scripted('login', 'login', def(`${API}/login-data`, {
        extractions: [{ enabled: true, variable: 'sessionId', source: 'json', expression: '$.session', secret: false }],
        assertions: [
          { enabled: true, target: 'status', operator: 'equals', expected: '200' },
          { enabled: true, target: 'json', property: '$.user.id', operator: 'equals', expected: '7' },
          { enabled: true, target: 'header', property: 'x-token', operator: 'exists' },
        ] }), 'f'),
      scripted('profile', 'profile', def(`${API}/me/{{sessionId}}`, {
        assertions: [{ enabled: true, target: 'json', property: '$.session', operator: 'equals', expected: '{{sessionId}}' }] }), 'f'),
    ],
    [{ id: 'f', collectionId: 'c', parentId: null, name: 'Flow', sortOrder: 0 }],
  );

  test('a value extracted from one response is used by the next request; failed assertions are reported', async ({ app, page }) => {
    await app.open();
    await app.importJson('chain.json', chain);
    await expandNode(page, 'Collection', 'Adv');
    await expandNode(page, 'Folder', 'Flow');
    await page.getByRole('button', { name: 'Manage' }).click();
    await app.dialog.getByRole('button', { name: 'New', exact: true }).click();
    await app.dialog.getByRole('button', { name: 'Done' }).click();
    await page.locator('#active-environment').selectOption({ label: 'Environment 1' });

    await requestButton(page, 'login').click();
    await app.sendTo(`${API}/login-data`);
    await app.responseTab(/^Tests/).click();
    await expect(page.getByText('3 of 3 passed')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Extracted variables' })).toContainText('s-42');

    await requestButton(page, 'profile').click();
    allowConsole(page, /404|Failed to load resource/i); // the mock API has no /me route handler status issues
    const response = await app.sendCurrent(`${API}/me/`);
    expect(response.url()).toBe(`${API}/me/s-42`);

    // An assertion that cannot hold fails visibly.
    await app.editorTab(/^Tests/).click();
    await page.getByRole('button', { name: 'Add assertion' }).click();
    await page.getByRole('combobox', { name: 'Check' }).last().selectOption('status');
    await page.getByLabel('Expected value').last().fill('201');
    await app.send();
    await app.responseTab(/^Tests/).click();
    await expect(page.getByText(/1 of 2 passed/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Test results' })).toContainText('Actual: 200');
  });

  test('Run… sends a folder in order and passes values along, even with no environment selected', async ({ app, page }) => {
    await app.open();
    await app.importJson('chain.json', chain);
    await expandNode(page, 'Collection', 'Adv');
    await page.getByRole('button', { name: 'Actions for Flow' }).click();
    await page.getByRole('menuitem', { name: 'Run…' }).click();
    await expect(app.dialog.getByText('2 requests will be sent')).toBeVisible();
    await app.dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(app.dialog.getByRole('status')).toContainText('2 passed · 0 failed', { timeout: 15_000 });
    await expect(app.dialog.getByRole('list', { name: 'Results' })).toContainText('sessionId');
    const meCalls = ((await (await fetch(`${API}/hits`)).json()) as string[]).filter((h) => h.startsWith('/me/'));
    expect(meCalls.at(-1)).toBe('/me/s-42');
  });
});

test('GraphQL is sent as a JSON document with query, variables and operation name', async ({ app, page }) => {
  await app.open();
  await app.importJson('g.json', file([scripted('graphql', 'a', def(`${API}/graphql`, {
    method: 'POST', body: { type: 'graphql', query: 'query Q($id: ID!) { user(id: $id) { name } }', variables: '{"id": 1}', operationName: 'Q' } }))]));
  await expandNode(page, 'Collection', 'Adv');
  await requestButton(page, 'graphql').click();
  await app.editorTab(/^Body/).click();
  await expect(page.getByRole('radio', { name: 'GraphQL' })).toBeChecked();
  await expect(page.getByLabel('Operation name (optional)')).toHaveValue('Q');
  const echoed = (await (await app.sendTo(`${API}/graphql`)).json()).data;
  expect(echoed.contentType).toBe('application/json');
  expect(echoed.received).toMatchObject({ operationName: 'Q', variables: { id: 1 } });
  expect(echoed.received.query).toContain('query Q');
});

test('OAuth 2.0 Authorization Code with PKCE: the provider verifies the verifier, no secret is sent, tokens are not stored', async ({ app, page, context }) => {
  await app.open();
  await app.importJson('o.json', file([scripted('protected', 'a', def(`${API}/protected`, {
    auth: { type: 'oauth2', authorizationUrl: `${API}/oauth/authorize`, tokenUrl: `${API}/oauth/token`, clientId: 'studio-test', scope: 'read' } }))]));
  await expandNode(page, 'Collection', 'Adv');
  await requestButton(page, 'protected').click();

  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('app-response-viewer').getByRole('alert')).toContainText('Get new token'); // nothing is sent without a token

  await app.editorTab(/^Authorization/).click();
  await expect(page.getByText('Not signed in.')).toBeVisible();
  await expect(page.getByText(`${new URL(page.url()).origin}/oauth/callback`).first()).toBeVisible();
  await expect(page.locator('app-auth-editor label', { hasText: /secret/i })).toHaveCount(0);

  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Get new token' }).click();
  await popup;
  await expect(page.getByText(/Signed in\./)).toBeVisible({ timeout: 15_000 });

  const log: { step: string; [k: string]: unknown }[] = await (await fetch(`${API}/oauth-log`)).json();
  const authorize = log.filter((e) => e.step === 'authorize').at(-1)!;
  const token = log.filter((e) => e.step === 'token').at(-1)!;
  expect(authorize).toMatchObject({ responseType: 'code', method: 'S256', hasSecret: false });
  expect(token).toMatchObject({ pkceVerified: true, hasSecret: false, redirectMatches: true });

  const response = await app.sendTo(`${API}/protected`);
  expect(response.status()).toBe(200);
  expect((await response.json()).auth).toMatch(/^Bearer at-\d+$/);

  const everything = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('api-studio');
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names);
          const out: string[] = [JSON.stringify([localStorage, sessionStorage])];
          let pending = names.length;
          for (const name of names) {
            const r = tx.objectStore(name).getAll();
            r.onsuccess = () => {
              out.push(JSON.stringify(r.result));
              if (--pending === 0) resolve(out.join(''));
            };
          }
        };
      }),
  );
  expect(everything).not.toMatch(/at-\d+|rt-1/);
});

test('WebSocket and Server-Sent Events tabs', async ({ app, page }) => {
  await app.open();
  await page.getByRole('button', { name: 'New tab' }).click();
  await page.getByRole('menuitem', { name: 'WebSocket' }).click();
  await page.getByLabel('WebSocket URL').fill('ws://localhost:4400/ws');
  await page.getByRole('button', { name: 'Connect' }).click();
  const log = page.getByRole('log', { name: 'Message log' });
  await expect(log.getByText('welcome')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('hi there');
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect(log).toContainText('echo: hi there');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Disconnected' })).toBeVisible();

  await page.getByRole('button', { name: 'New tab' }).click();
  await page.getByRole('menuitem', { name: 'Event stream (SSE)' }).click();
  await page.getByLabel('Event stream URL').fill(`${API}/sse`);
  await page.getByPlaceholder('Header').first().fill('X-Stream-Key');
  await page.getByPlaceholder('Value').first().fill('abc');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(log).toContainText('The server closed the stream.');
  await expect(log).toContainText('key=abc'); // custom headers work, which EventSource cannot do
  await expect(log).toContainText('price');
  await expect(log).toContainText('line1');
  await expect(log).toContainText('line2');
});
