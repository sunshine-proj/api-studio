import { readFileSync } from 'node:fs';
import { API, allowConsole, chooseMethod, expect, fillRow, setEditorText, test } from './support/fixtures';

test.describe('Response viewer', () => {
  test('JSON offers pretty, tree and raw views, and the tree is collapsible and paged', async ({ app, page }) => {
    await app.open();
    await app.sendTo(`${API}/json`);
    const views = page.getByRole('radiogroup', { name: 'Body view' });
    await expect(views.getByRole('radio')).toHaveText(['Pretty', 'Tree', 'Raw']);
    await views.getByRole('radio', { name: 'Tree' }).click();
    const tree = page.getByRole('region', { name: 'JSON tree' });
    await expect(tree.getByText('"api"')).toBeVisible();
    await expect(tree.getByRole('button', { name: /Show 100 more/ })).toBeVisible(); // 250 items, 100 at a time
    await tree.getByRole('button', { name: 'Collapse nested' }).click();
    await expect(tree.getByText('s', { exact: true })).toHaveCount(0);
    await tree.getByRole('button', { name: 'Expand nested' }).click();
    await expect(tree.getByText('s', { exact: true })).toHaveCount(1);
    await views.getByRole('radio', { name: 'Raw' }).click();
    await expect(page.getByLabel('Response body').first()).toBeVisible();
  });

  test('HTML is shown as source; the preview is sandboxed and cannot run scripts or load external resources', async ({ app, page }) => {
    // The hostile page's blocked script and image are reported by the browser; that is the sandbox working.
    allowConsole(page, /sandbox|Content Security Policy|CSP|violat|blocked|Refused|Layout was forced/i);
    await app.open();
    await app.sendTo(`${API}/html`);
    await expect(page.locator('iframe')).toHaveCount(0); // nothing is rendered until asked for
    await page.getByRole('radiogroup', { name: 'Body view' }).getByRole('radio', { name: 'Preview' }).click();
    const frame = page.locator('app-html-preview iframe');
    await expect(frame).toHaveAttribute('sandbox', '');
    await expect(page.frameLocator('app-html-preview iframe').locator('h1')).toHaveText('Hello preview');
    expect(await frame.evaluate((f: HTMLIFrameElement) => f.contentDocument)).toBeNull(); // no same-origin access
    await page.waitForTimeout(800);
    const hits: string[] = await (await fetch(`${API}/hits`)).json();
    expect(hits).not.toContain('/beacon-script');
    expect(hits).not.toContain('/beacon-img');
  });

  test('images (including SVG) preview, and binary content downloads under the server\'s file name', async ({ app, page }) => {
    await app.open();
    await app.sendTo(`${API}/png`);
    await expect(page.getByRole('img', { name: 'Response image' })).toBeVisible();
    await expect(page.getByText('1 × 1 px')).toBeVisible();
    await app.sendTo(`${API}/svg`);
    await expect.poll(() => page.getByRole('img', { name: 'Response image' }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40);

    await app.sendTo(`${API}/bin`);
    await expect(page.getByText('cannot be shown as text')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('data.bin');
    expect([...readFileSync(await download.path())]).toEqual([0, 1, 2, 3, 255]);
  });

  test('a body above the size limit is not displayed, the user is told, and it can be downloaded; the limit is a setting', async ({ app, page }) => {
    await app.open();
    await app.sendTo(`${API}/big`);
    await expect(page.getByText('was not displayed')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('big.txt');

    await app.openSettings();
    await app.dialog.getByLabel('Largest response shown (MB)').fill('20');
    await app.dialog.getByRole('button', { name: 'Save' }).click();
    await expect(app.dialog).toBeHidden();
    await expect(page.getByText('was not displayed')).toBeHidden();
    await expect(page.getByLabel('Response body').first()).toBeVisible();
  });
});

test.describe('Request history', () => {
  test('keeps what was sent, redacts credentials before storing, and reopens a request', async ({ app, page }) => {
    await app.open();
    await app.editorTab(/^Headers/).click();
    await fillRow(page.locator('app-request-editor'), 0, 'Authorization', 'Bearer topsecret-token-123');
    await app.sendTo(`${API}/echo?marker=one`);

    await page.getByRole('radio', { name: 'History' }).click();
    await expect(page.locator('app-history-panel li')).toHaveCount(1);
    await expect(page.locator('app-history-panel li')).toContainText('200');

    // What is actually in IndexedDB, not just what the screen shows.
    const stored = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open('api-studio');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction('history').objectStore('history').getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result));
          };
        }),
    );
    expect(stored).not.toContain('topsecret-token-123');
    expect(stored).toContain('[redacted]');

    await page.locator('app-history-panel').getByRole('button', { name: /^GET .*marker=one/ }).click();
    await expect(app.url).toHaveValue(`${API}/echo?marker=one`);
    await app.editorTab(/^Headers/).click();
    await expect(page.locator('app-request-editor app-key-value-editor input:not([type=checkbox])').nth(1)).toHaveValue('[redacted]');
  });

  test('is limited to the configured size, oldest first, and can be cleared', async ({ app, page }) => {
    await app.open();
    await app.openSettings();
    await app.dialog.getByLabel('History entries kept').fill('2');
    await app.dialog.getByRole('button', { name: 'Save' }).click();
    for (const n of [1, 2, 3]) await app.sendTo(`${API}/echo?n=${n}`);
    await page.getByRole('radio', { name: 'History' }).click();
    const entries = page.locator('app-history-panel li');
    await expect(entries).toHaveCount(2);
    await expect(entries.first()).toContainText('n=3');
    await expect(entries.last()).toContainText('n=2');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await app.dialog.getByRole('button', { name: 'Clear history' }).click();
    await expect(entries).toHaveCount(0);
  });
});

test('GET requests cannot have a body, and the user is told', async ({ app, page }) => {
  await app.open();
  await chooseMethod(page, 'GET');
  await app.editorTab(/^Body/).click();
  await page.getByRole('radio', { name: 'Text' }).check();
  await setEditorText(page, 'Request body (text)', 'ignored');
  await app.sendTo(`${API}/echo`);
  await expect(page.getByRole('list', { name: 'Warnings' })).toContainText('GET requests cannot have a body');
});
