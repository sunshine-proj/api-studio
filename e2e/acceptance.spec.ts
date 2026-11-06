// The acceptance criteria of PRD section 10, one workflow each, against the production build.
import { readFileSync } from 'node:fs';
import { API, allowConsole, chooseMethod, expandNode, expect, fillRow, setEditorText, test, requestButton } from './support/fixtures';

test.describe('A user can create, execute and inspect an HTTP request', () => {
  test('query parameters, headers, environment variables and the response viewer', async ({ app, page }) => {
    await app.open();

    // Query parameters follow the URL, in both directions.
    await app.url.fill(`${API}/echo?a=1&b=2`);
    await app.editorTab(/^Params/).click();
    const params = page.locator('app-request-editor');
    await expect(params.locator('app-key-value-editor:visible input:not([type=checkbox])').nth(0)).toHaveValue('a');
    await fillRow(params, 2, 'c', '3');
    await expect(app.url).toHaveValue(`${API}/echo?a=1&b=2&c=3`);

    // A custom header is sent.
    await app.editorTab(/^Headers/).click();
    await fillRow(page.locator('app-request-editor'), 0, 'X-Custom', 'hello');

    // Variables of the selected environment are filled in; an undefined one is reported, not silently emptied.
    await page.getByRole('button', { name: 'Manage' }).click();
    await app.dialog.getByRole('button', { name: 'New', exact: true }).click();
    await app.dialog.getByRole('button', { name: 'Add variable' }).click();
    await app.dialog.getByLabel('Variable name').fill('host');
    await app.dialog.getByLabel('Variable value').fill('localhost:4400');
    await app.dialog.getByRole('button', { name: 'Done' }).click();
    await page.locator('#active-environment').selectOption({ label: 'Environment 1' });
    await app.url.fill('http://{{host}}/echo?a=1&b=2&c=3&missing={{nope}}');

    const response = await app.sendCurrent('http://localhost:4400/echo');
    const echoed = await response.json();
    expect(echoed.headers['x-custom']).toBe('hello');
    expect(echoed.query).toMatchObject({ a: '1', b: '2', c: '3', missing: '{{nope}}' });
    await expect(page.getByRole('list', { name: 'Warnings' })).toContainText('Variable {{nope}} is not defined');

    // The response viewer: status, time, size, body, headers.
    await expect(page.getByLabel('HTTP status')).toContainText('200 OK');
    await expect(page.getByText(/^Time: /)).toBeVisible();
    await expect(page.getByText(/^Size: /)).toBeVisible();
    await expect(page.getByLabel('Response body').first()).toBeVisible();
    await app.responseTab(/^Headers/).click();
    await expect(page.getByRole('table', { name: 'Response headers' })).toContainText('content-type');
  });

  test('every HTTP method, and a JSON request body', async ({ app, page }) => {
    await app.open();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await chooseMethod(page, method);
      const response = await app.sendTo(`${API}/echo`);
      expect((await response.json()).method).toBe(method);
    }
    await chooseMethod(page, 'POST');
    await app.editorTab(/^Body/).click();
    await page.getByRole('radio', { name: 'JSON' }).check();
    await setEditorText(page, 'Request body (json)', '{"hello":"world"}');
    const response = await app.sendTo(`${API}/echo`);
    const echoed = await response.json();
    expect(echoed.headers['content-type']).toBe('application/json');
    expect(echoed.body).toContain('"hello":"world"');
  });

  test('URL-encoded forms', async ({ app, page }) => {
    await app.open();
    await chooseMethod(page, 'POST');
    await app.editorTab(/^Body/).click();
    await page.getByRole('radio', { name: 'Form URL Encoded' }).check();
    await fillRow(page.locator('app-body-editor'), 0, 'name', 'Ann Lee');
    const echoed = await (await app.sendTo(`${API}/echo`)).json();
    expect(echoed.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(echoed.body).toBe('name=Ann+Lee');
  });
});

test.describe('A user can upload files and submit multipart forms', () => {
  const files = [
    { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('first file') },
    { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('second file!') },
  ];

  test('several files under one field name, mixed with a text field', async ({ app, page }) => {
    await app.open();
    await chooseMethod(page, 'POST');
    await app.editorTab(/^Body/).click();
    await page.getByRole('radio', { name: 'Multipart Form Data' }).check();
    await page.getByRole('button', { name: 'Add text field' }).click();
    await page.getByLabel('Field name').first().fill('note');
    await page.getByLabel('Field value').first().fill('hello');
    await page.locator('app-multipart-editor input[type=file][multiple]').setInputFiles(files);
    await expect(page.getByText('a.txt')).toBeVisible();
    await expect(page.getByText('b.txt')).toBeVisible();

    const result = await (await app.sendTo(`${API}/upload`)).json();
    expect(result.contentType).toBe('multipart/form-data');
    expect(result.parts).toEqual([
      { name: 'note', filename: null, size: 5, value: 'hello' },
      { name: 'file', filename: 'a.txt', size: 10 },
      { name: 'file', filename: 'b.txt', size: 12 },
    ]);
  });

  test('a removed file is not sent, and a binary body is sent as-is', async ({ app, page }) => {
    await app.open();
    await chooseMethod(page, 'POST');
    await app.editorTab(/^Body/).click();
    await page.getByRole('radio', { name: 'Multipart Form Data' }).check();
    await page.locator('app-multipart-editor input[type=file][multiple]').setInputFiles(files);
    await page.getByRole('button', { name: 'Remove field' }).first().click();
    const multipart = await (await app.sendTo(`${API}/upload`)).json();
    expect(multipart.parts.map((p: { filename: string }) => p.filename)).toEqual(['b.txt']);

    await page.getByRole('radio', { name: 'Binary' }).check();
    await page.locator('app-body-editor input[type=file]').setInputFiles(files[1]);
    const binary = await (await app.sendTo(`${API}/upload`)).json();
    expect(binary).toMatchObject({ contentType: 'text/plain', size: 12, parts: [] });
  });

  test('a saved request asks for the file again instead of keeping its contents', async ({ app, page }) => {
    await app.open();
    await app.createCollection('Uploads');
    await chooseMethod(page, 'POST');
    await app.url.fill(`${API}/upload`);
    await app.editorTab(/^Body/).click();
    await page.getByRole('radio', { name: 'Multipart Form Data' }).check();
    await page.locator('app-multipart-editor input[type=file][multiple]').setInputFiles(files[0]);
    await app.url.press('Control+s'); // the shortcut works while focus is in the request editor
    await app.dialog.getByRole('button', { name: 'Save' }).click();
    await expandNode(page, 'Collection', 'Uploads');
    await expect(page.locator('app-collections-sidebar').getByRole('button', { name: /^[A-Z]+ / })).toBeVisible(); // stored before the page goes away
    await page.reload();
    await expandNode(page, 'Collection', 'Uploads');
    await page.locator('app-collections-sidebar').getByRole('button', { name: /^[A-Z]+ / }).click();
    await app.editorTab(/^Body/).click();
    await expect(page.getByText('a.txt')).toBeVisible(); // the name is remembered…
    await app.send();
    await expect(page.locator('app-response-viewer')).toContainText('is not selected. Choose it again'); // …the contents are not
  });
});

test.describe('A user can save requests and organize them into collections', () => {
  test('collections, nested folders, save, duplicate, move, rename and delete', async ({ app, page }) => {
    await app.open();
    await app.createCollection('Payments');
    await app.createCollection('Archive');

    await page.getByRole('button', { name: 'Actions for Payments' }).click();
    await page.getByRole('menuitem', { name: 'New folder' }).click();
    await app.dialog.getByLabel('Folder name').fill('v1');
    await app.dialog.getByRole('button', { name: 'Create' }).click();
    await expandNode(page, 'Collection', 'Payments');
    await expect(page.getByRole('button', { name: 'Folder v1' })).toBeVisible();

    await app.url.fill(`${API}/json`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await app.dialog.getByLabel('Name').fill('List payments');
    await app.dialog.getByRole('combobox').nth(0).selectOption({ label: 'Payments' }); // collection
    await app.dialog.getByRole('combobox').nth(1).selectOption({ label: 'v1' }); // folder
    await app.dialog.getByRole('button', { name: 'Save' }).click();
    await expandNode(page, 'Folder', 'v1');
    await expect(requestButton(page, 'List payments')).toBeVisible();
    await expect(app.tabStrip.getByRole('tab', { selected: true })).toContainText('List payments');

    await page.getByRole('button', { name: 'Actions for List payments' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(requestButton(page, 'List payments copy')).toBeVisible();

    await page.getByRole('button', { name: 'Actions for List payments copy' }).click();
    await page.getByRole('menuitem', { name: 'Move…' }).click();
    await app.dialog.getByRole('combobox').nth(0).selectOption({ label: 'Archive' });
    await app.dialog.getByRole('button', { name: 'Move' }).click();
    await expandNode(page, 'Collection', 'Archive');
    await expect(requestButton(page, 'List payments copy')).toBeVisible();

    await page.getByRole('button', { name: 'Actions for List payments copy' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await app.dialog.getByLabel('Name').fill('Old payments');
    await app.dialog.getByRole('button', { name: 'Rename' }).click();
    await expect(requestButton(page, 'Old payments')).toBeVisible();

    await page.getByRole('button', { name: 'Actions for Old payments' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await app.dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(requestButton(page, 'Old payments')).toHaveCount(0);
    await expect(requestButton(page, 'List payments')).toBeVisible();
  });

  test('multiple tabs keep unsaved changes, and closing a changed tab asks first', async ({ app, page }) => {
    await app.open();
    await app.url.fill(`${API}/one`);
    await page.getByRole('button', { name: 'New tab' }).click();
    await page.getByRole('menuitem', { name: 'HTTP request' }).click();
    await app.url.fill(`${API}/two`);
    await app.tabStrip.getByRole('tab').first().click();
    await expect(app.url).toHaveValue(`${API}/one`);
    await app.tabStrip.getByRole('tab').nth(1).click();
    await expect(app.url).toHaveValue(`${API}/two`);
    await expect(app.tabStrip.getByRole('tab').nth(1)).toContainText('(unsaved changes)');

    const second = app.tabStrip.getByRole('tab').nth(1);
    await second.focus();
    await page.keyboard.press('Delete'); // closing a changed tab asks first
    await app.dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.tabStrip.getByRole('tab')).toHaveCount(2);
    await second.focus();
    await page.keyboard.press('Delete');
    await app.dialog.getByRole('button', { name: 'Close without saving' }).click();
    await expect(app.tabStrip.getByRole('tab')).toHaveCount(1);
  });
});

test.describe('Saved data survives a browser restart', () => {
  test('collections, requests, environments, the theme and history are all still there after a reload', async ({ app, page }) => {
    await app.open();
    await app.createCollection('Kept');
    await app.url.fill(`${API}/json`);
    await app.url.press('Control+s');
    await app.dialog.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Manage' }).click();
    await app.dialog.getByRole('button', { name: 'New', exact: true }).click();
    await app.dialog.getByRole('button', { name: 'Add variable' }).click();
    await app.dialog.getByLabel('Variable name').fill('token');
    await app.dialog.getByLabel('Variable value').fill('abc123');
    await app.dialog.getByRole('button', { name: 'Done' }).click();
    await page.locator('#active-environment').selectOption({ label: 'Environment 1' });
    await page.getByLabel('Theme').selectOption('dark');
    await app.send();
    // Let Monaco finish loading first. Reloading while its script is downloading makes Firefox log the aborted load.
    await expect(page.locator('.monaco-editor').first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Storage notice' })).toBeHidden(); // acknowledged once, remembered
    await expandNode(page, 'Collection', 'Kept');
    await expect(page.locator('app-collections-sidebar').getByRole('button', { name: /^[A-Z]+ / })).toBeVisible();
    await expect(page.locator('#active-environment')).toHaveValue(/.+/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'History' }).click();
    await expect(page.locator('app-history-panel li')).toHaveCount(1);
  });
});

test.describe('A user can export and import collections', () => {
  test('the app\'s own export imports into a brand new browser profile, without credentials by default', async ({ app, page, browser }) => {
    await app.open();
    await app.createCollection('Shop');
    await app.url.fill(`${API}/protected`);
    await app.editorTab(/^Authorization/).click();
    await page.locator('app-auth-editor select').selectOption('bearer');
    await page.locator('app-auth-editor input[type=password]').fill('super-secret-token');
    await app.url.press('Control+s');
    await app.dialog.getByLabel('Name').fill('Protected call');
    await app.dialog.getByRole('button', { name: 'Save' }).click();

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(app.dialog.getByRole('note')).toContainText('1 request with credentials');
    const [download] = await Promise.all([page.waitForEvent('download'), app.dialog.getByRole('button', { name: 'Export', exact: true }).click()]);
    const exported = readFileSync(await download.path(), 'utf8');
    expect(exported).not.toContain('super-secret-token');
    expect(JSON.parse(exported)).toMatchObject({ format: 'api-studio', collections: [{ name: 'Shop' }] });

    // A fresh profile: nothing stored yet.
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto('/');
    await other.getByRole('button', { name: 'Got it' }).click();
    await other.getByRole('button', { name: 'Import', exact: true }).click();
    await other.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'shop.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await expect(other.getByRole('region', { name: 'Import summary' })).toContainText('1 request');
    await other.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
    await other.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expandNode(other, 'Collection', 'Shop');
    await expect(requestButton(other, 'Protected call')).toBeVisible();
    await fresh.close();
  });

  test('Postman collections and OpenAPI descriptions import; hostile files are rejected', async ({ app, page }) => {
    await app.open();
    await app.importJson('postman.json', {
      info: { name: 'From Postman' },
      item: [{ name: 'Ping', request: { method: 'GET', url: `${API}/ping` } }],
    });
    await app.importJson('openapi.json', {
      openapi: '3.0.0', info: { title: 'From OpenAPI' }, servers: [{ url: API }],
      paths: { '/ping': { get: { summary: 'Ping it' } } },
    });
    await expect(page.getByRole('button', { name: 'Collection From Postman' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collection From OpenAPI' })).toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await app.dialog.locator('input[type=file]').setInputFiles({ name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"api-studio","version":1,"__proto__":{"x":1}}') });
    await expect(app.dialog.getByRole('alert')).toContainText('forbidden key "__proto__"');
    await expect(app.dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await app.dialog.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Browser security limitations are handled transparently', () => {
  test('a CORS failure is described as "possibly CORS", never as a certain diagnosis', async ({ app, page }) => {
    allowConsole(page, /CORS|Cross-Origin|ERR_FAILED|Failed to load resource|NetworkError/i);
    await app.open();
    await app.url.fill(`${API}/nocors`);
    await app.send();
    const alert = page.locator('app-response-viewer').getByRole('alert');
    await expect(alert).toContainText('Request failed');
    await expect(alert).toContainText('possibly a CORS problem');
    await expect(alert).toContainText('Browsers hide the exact reason');
  });

  test('an unreachable server, a cancelled request and forbidden headers are each reported distinctly', async ({ app, page }) => {
    allowConsole(page, /ERR_CONNECTION_REFUSED|Failed to load resource|NetworkError|Cross-Origin/i);
    await app.open();

    await app.url.fill('http://localhost:1/');
    await app.send();
    await expect(page.locator('app-response-viewer').getByRole('alert')).toContainText(/Request failed/);

    await app.url.fill(`${API}/slow`);
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('app-response-viewer').getByRole('alert')).toContainText('Request cancelled');

    await app.editorTab(/^Headers/).click();
    await fillRow(page.locator('app-request-editor'), 0, 'Cookie', 'a=b');
    await app.sendTo(`${API}/echo`);
    await expect(page.getByRole('list', { name: 'Warnings' })).toContainText('Header "Cookie" was not sent');
  });

  test('Set-Cookie cannot be read, and the response says so instead of implying there were no cookies', async ({ app, page }) => {
    await app.open();
    await app.sendTo(`${API}/cookies`);
    await app.responseTab('Cookies').click();
    await expect(page.locator('app-response-viewer')).toContainText('Browsers do not expose Set-Cookie');
  });

  test('a 4xx or 5xx status is a normal response, not an error', async ({ app, page }) => {
    allowConsole(page, /404|500|Failed to load resource/i);
    await app.open();
    const response = await app.sendTo(`${API}/status/404`);
    expect(response.status()).toBe(404);
    await expect(page.getByLabel('HTTP status')).toContainText('404 Not Found');
    await expect(page.locator('app-response-viewer').getByRole('alert')).toHaveCount(0);
  });
});
