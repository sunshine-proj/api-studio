// Automated WCAG 2.2 AA checks (axe-core) of every major screen, in the light and the dark theme.
// Automated checks find only part of the accessibility problems; keyboard.spec.ts and the manual review in the
// README cover the rest. Monaco (the third-party code editor) and the HTML preview frame (untrusted response content in a fully sandboxed iframe, which scripts such as axe cannot enter by design) are excluded.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { API, allowConsole, expandNode, expect, test, type App } from './support/fixtures';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/** Console noise that is expected while touring screens: the test API's 404 and the hostile HTML sample's blocked content. */
const EXPECTED_CONSOLE = /404|Failed to load resource|sandbox|Content Security Policy|CSP|violat|Refused|blocked|Duplicate definition of module 'axe-core'|Layout was forced before the page was fully loaded/i;

async function audit(page: Page, label: string): Promise<void> {
  if (process.env['A11Y_VERBOSE']) console.log(`audit: ${label}`);
  await page.waitForTimeout(450); // dialogs and menus fade in; measuring mid-fade reports colours that are not what users see
  const axe = new AxeBuilder({ page }).withTags(TAGS).exclude('.monaco-editor').exclude('app-html-preview iframe');
  const results = await axe.analyze();
  const problems = results.violations.map(
    (v) => `${v.id} [${v.impact}] ${v.help}\n    ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join('\n    ')}`,
  );
  expect.soft(problems, label).toEqual([]);
}

async function start(page: Page, app: App, theme: Theme): Promise<(what: string) => Promise<void>> {
  allowConsole(page, EXPECTED_CONSOLE);
  await app.open();
  await page.getByLabel('Theme').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.waitForTimeout(700); // let Material's colour transitions finish, or axe measures a half-faded colour
  return (what) => audit(page, `${what} (${theme} theme)`);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme: no WCAG 2.2 AA violations`, () => {
    test.setTimeout(240_000);

    test('workspace and request editor', async ({ app, page }) => {
      const check = await start(page, app, theme);
      await check('empty workspace');
      for (const tab of [/^Params/, /^Headers/, /^Authorization/, /^Body/, /^Tests/, /^Scripts/]) {
        await app.editorTab(tab).click();
        await check(`request editor › ${String(tab)}`);
      }
      await app.editorTab(/^Authorization/).click();
      for (const type of ['basic', 'bearer', 'apiKey', 'custom', 'oauth2']) {
        await page.locator('app-auth-editor select').first().selectOption(type);
        await check(`authorization › ${type}`);
      }
      await app.editorTab(/^Body/).click();
      for (const kind of ['Form URL Encoded', 'Multipart Form Data', 'Binary', 'GraphQL']) {
        await page.getByRole('radio', { name: kind }).check();
        await check(`body › ${kind}`);
      }
      await app.editorTab(/^Tests/).click();
      await page.getByRole('button', { name: 'Add assertion' }).click();
      await page.getByRole('button', { name: 'Add extraction' }).click();
      await check('tests editor with rows');
    });

    test('responses', async ({ app, page }) => {
      const check = await start(page, app, theme);
      // One passing and one failing assertion, so both result colours are on screen.
      await app.editorTab(/^Tests/).click();
      await page.getByRole('button', { name: 'Add assertion' }).click();
      await page.getByRole('button', { name: 'Add assertion' }).click();
      await page.getByRole('combobox', { name: 'Check' }).nth(1).selectOption('status');
      await page.getByLabel('Expected value').nth(1).fill('201');
      // Firefox 159 crashes the page when axe runs while the Tests editor is shown with a URL typed (the crash is in
      // Firefox, not the app: its accessibility tree can be read, and Chromium audits this screen fine). The Tests
      // editor is audited with rows in the test above, so go back to the Params tab before auditing responses.
      await app.editorTab(/^Params/).click();
      await app.sendTo(`${API}/json`);
      await check('JSON response › pretty');
      await page.getByRole('radiogroup', { name: 'Body view' }).getByRole('radio', { name: 'Tree' }).click();
      await check('JSON response › tree');
      for (const tab of ['Headers', 'Cookies', 'Tests']) {
        await app.responseTab(new RegExp(`^${tab}`)).click();
        await check(`response › ${tab}`);
      }
      await app.sendTo(`${API}/html`);
      await app.responseTab(/^Body/).click();
      await page.getByRole('radiogroup', { name: 'Body view' }).getByRole('radio', { name: 'Preview' }).click();
      await check('HTML preview');
      await app.sendTo(`${API}/png`);
      await check('image response');
      await app.sendTo(`${API}/bin`);
      await check('binary response');
      await app.sendTo(`${API}/status/404`);
      await check('404 response');
      await app.url.fill('http://localhost:1/');
      await app.send();
      await check('failed request');
    });

    test('sidebar, history and run dialog', async ({ app, page }) => {
      const check = await start(page, app, theme);
      await app.createCollection('Audit');
      await app.url.fill(`${API}/json`);
      await app.url.press('Control+s');
      await expect(app.dialog).toBeVisible();
      await check('save dialog');
      await app.dialog.getByRole('button', { name: 'Save' }).click();
      await expandNode(page, 'Collection', 'Audit');
      await check('sidebar with a collection and a request');
      await app.send();
      await page.getByRole('radio', { name: 'History' }).click();
      await check('history');
      await page.getByRole('radio', { name: 'Collections' }).click();
      await page.getByRole('button', { name: 'Actions for Audit' }).click();
      await check('collection menu');
      await page.getByRole('menuitem', { name: 'Run…' }).click();
      await check('run dialog before running');
      await app.dialog.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(app.dialog.getByRole('status')).toContainText('passed');
      await check('run dialog with results');
    });

    test('dialogs', async ({ app, page }) => {
      const check = await start(page, app, theme);
      for (const [button, name] of [['Settings', 'settings'], ['Manage', 'environments'], ['Import', 'import'], ['Export', 'export']] as const) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(app.dialog).toBeVisible();
        await check(`${name} dialog`);
        await page.keyboard.press('Escape');
        await expect(app.dialog).toBeHidden();
      }
      await page.getByRole('button', { name: 'Manage' }).click();
      await app.dialog.getByRole('button', { name: 'New', exact: true }).click();
      await app.dialog.getByRole('button', { name: 'Add variable' }).click();
      await check('environment dialog with a variable');
      await app.dialog.getByRole('button', { name: 'Done' }).click();

      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await app.dialog.locator('input[type=file]').setInputFiles({
        name: 'p.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ info: { name: 'P' }, event: [{ listen: 'test' }], item: [{ name: 'r', request: { method: 'GET', url: `${API}/ping` } }] })),
      });
      await expect(app.dialog.getByRole('region', { name: 'Import summary' })).toBeVisible();
      await check('import dialog with a preview and warnings');
    });

    test('realtime tabs', async ({ app, page }) => {
      const check = await start(page, app, theme);
      await page.getByRole('button', { name: 'New tab' }).click();
      await check('new-tab menu');
      await page.getByRole('menuitem', { name: 'WebSocket' }).click();
      await check('WebSocket tab');
      await page.getByLabel('WebSocket URL').fill('ws://localhost:4400/ws');
      await page.getByRole('button', { name: 'Connect' }).click();
      await expect(page.getByRole('log', { name: 'Message log' }).getByText('welcome')).toBeVisible();
      await check('WebSocket tab, connected, with messages');
      await page.getByRole('button', { name: 'New tab' }).click();
      await page.getByRole('menuitem', { name: 'Event stream (SSE)' }).click();
      await check('event stream tab');
    });
  });
}

test('the first-run storage notice is accessible', async ({ page }) => {
  allowConsole(page, EXPECTED_CONSOLE);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Storage notice' })).toBeVisible();
  await audit(page, 'first-run storage notice');
});
