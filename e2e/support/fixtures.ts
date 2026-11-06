import { expect, test as base, type Locator, type Page, type Response } from '@playwright/test';

export const API = 'http://localhost:4400';

export class App {
  constructor(readonly page: Page) {}

  /** Opens the app and dismisses the first-run storage notice, which every new browser profile sees. */
  async open(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.getByRole('region', { name: 'Storage notice' })).toBeVisible();
    await this.page.getByRole('button', { name: 'Got it' }).click();
    await expect(this.page.getByRole('region', { name: 'Storage notice' })).toBeHidden();
  }

  get url(): Locator {
    return this.page.getByLabel('URL', { exact: true });
  }

  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  /** The request editor's tab (the response viewer also has tabs, such as "Headers"). */
  editorTab(name: string | RegExp): Locator {
    return this.page.locator('app-request-editor').getByRole('tab', { name });
  }

  responseTab(name: string | RegExp): Locator {
    return this.page.locator('app-response-viewer').getByRole('tab', { name });
  }

  get tabStrip(): Locator {
    return this.page.getByRole('tablist', { name: 'Open requests' });
  }

  /** Sends the current request and waits for it to finish. */
  async send(): Promise<void> {
    await this.page.getByRole('button', { name: 'Send' }).click();
    await expect(this.page.getByRole('button', { name: 'Cancel' })).toBeHidden();
  }

  /** Types a URL, sends, and resolves with the browser's view of the network response. */
  async sendTo(url: string): Promise<Response> {
    await this.url.fill(url);
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().startsWith(url.split('?')[0]) && r.request().method() !== 'OPTIONS'),
      this.page.getByRole('button', { name: 'Send' }).click(),
    ]);
    await expect(this.page.getByRole('button', { name: 'Cancel' })).toBeHidden();
    return response;
  }

  /** Sends the request as it is now (without retyping the URL) and resolves with the first response whose URL starts with `urlPrefix`. */
  async sendCurrent(urlPrefix: string): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().startsWith(urlPrefix) && r.request().method() !== 'OPTIONS'),
      this.page.getByRole('button', { name: 'Send' }).click(),
    ]);
    await expect(this.page.getByRole('button', { name: 'Cancel' })).toBeHidden();
    return response;
  }

  async openSettings(): Promise<void> {
    await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
  }

  async createCollection(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'New', exact: true }).click();
    await this.dialog.getByLabel('Collection name').fill(name);
    await this.dialog.getByRole('button', { name: 'Create' }).click();
    await expect(this.page.getByRole('button', { name: `Collection ${name}` })).toBeVisible();
  }

  /** Imports JSON through the Import dialog. */
  async importJson(name: string, content: unknown): Promise<void> {
    await this.page.getByRole('button', { name: 'Import', exact: true }).click();
    await this.dialog.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content)) });
    await this.dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(this.dialog.getByText('Import complete')).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Done' }).click();
    await expect(this.dialog).toBeHidden();
  }
}

/** Console patterns a test has declared as expected, per page. */
const allowances = new WeakMap<Page, RegExp[]>();

/** Declares a console message as expected for this test (for example a 404 or a CORS block it provokes on purpose). */
export function allowConsole(page: Page, pattern: RegExp): void {
  allowances.get(page)?.push(pattern);
}

/**
 * Every test fails if the page logs a console error or warning (or throws) that the test did not declare with
 * `allowConsole`. That is the release "console error check", applied to every workflow.
 */
export const test = base.extend<{ app: App }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    allowances.set(page, []);
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    await use(page);
    const allowed = allowances.get(page) ?? [];
    const unexpected = problems.filter((problem) => !allowed.some((pattern) => pattern.test(problem)));
    expect(unexpected, 'unexpected console errors or warnings').toEqual([]);
  },
  app: async ({ page }, use) => use(new App(page)),
});

export { expect };

/** Fills row `index` (0-based) of the visible key/value table inside `scope` (Params, Headers, form fields…). */
export async function fillRow(scope: Locator, index: number, key: string, value: string): Promise<void> {
  const row = scope.locator('app-key-value-editor:visible').first().locator('.row:not(.head)').nth(index);
  await row.locator('input:not([type=checkbox])').nth(0).fill(key);
  await row.locator('input:not([type=checkbox])').nth(1).fill(value);
}

/** Opens a collection or folder in the sidebar, unless it is already open (creating one opens it). */
export async function expandNode(page: Page, kind: 'Collection' | 'Folder', name: string): Promise<void> {
  const node = page.getByRole('button', { name: `${kind} ${name}` });
  await expect(node).toBeVisible();
  if ((await node.getAttribute('aria-expanded')) === 'false') await node.click();
  await expect(node).toHaveAttribute('aria-expanded', 'true');
}

/** Replaces the content of a Monaco editor. Text is inserted directly, because typing triggers auto-closing of brackets and quotes. */
export async function setEditorText(page: Page, label: string, text: string): Promise<void> {
  // Click the visible editor surface: Monaco's own input element is deliberately zero pixels wide.
  await page.locator(`.host[aria-label="${label}"]`).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

/** Selects an HTTP method in the request editor. */
export async function chooseMethod(page: Page, method: string): Promise<void> {
  await page.getByRole('combobox', { name: 'HTTP method' }).click();
  await page.getByRole('option', { name: method, exact: true }).click();
}

/** A saved request in the sidebar. Its accessible name is what is on screen: the method, then the name ("GET List users"). */
export function requestButton(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('app-collections-sidebar').getByRole('button', { name: new RegExp(`^[A-Z]+ ${escaped}$`) });
}
