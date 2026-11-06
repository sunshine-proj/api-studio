// Keyboard-only use: everything reachable, nothing trapping focus, shortcuts documented in the README.
import type { Page } from '@playwright/test';
import { API, expect, test } from './support/fixtures';

/** The accessible name (or text) of the element that currently has focus. */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '(body)';
    const labels = (el as HTMLInputElement).labels;
    const label = el.getAttribute('aria-label') ?? (labels && labels.length > 0 ? labels[0].textContent : null) ?? el.getAttribute('title') ?? el.textContent ?? el.getAttribute('placeholder') ?? el.id;
    return `${el.tagName.toLowerCase()}:${(label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}`;
  });
}

test('every main control can be reached with the Tab key, and focus is never trapped', async ({ app, page }) => {
  await app.open();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const visited: string[] = [];
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    visited.push(await focusedName(page));
  }
  const all = visited.join(' | ');
  for (const expected of ['Manage', 'Theme', 'Import', 'Export', 'Settings', 'New', 'New request', 'New tab', 'Tab actions', 'URL', 'Send', 'Save']) {
    expect(all, `Tab should reach "${expected}"`).toContain(expected);
  }
  // Not stuck: many different elements were visited.
  expect(new Set(visited).size).toBeGreaterThan(15); // the page's focus cycle has about 23 stops; it wraps around instead of getting stuck
  let repeats = 0;
  for (let i = 1; i < visited.length; i++) repeats = visited[i] === visited[i - 1] ? repeats + 1 : 0;
  expect(repeats).toBeLessThan(3);
});

test('shortcuts: Ctrl+Enter sends and Ctrl+S saves, while focus is in the request editor', async ({ app, page }) => {
  await app.open();
  await app.createCollection('Keys');
  await app.url.fill(`${API}/json`);
  const [response] = await Promise.all([page.waitForResponse(`${API}/json`), app.url.press('Control+Enter')]);
  expect(response.status()).toBe(200);
  await app.url.press('Control+s');
  await expect(app.dialog.getByRole('heading', { name: 'Save request' })).toBeVisible();
  await app.dialog.getByRole('button', { name: 'Save' }).press('Enter');
  await expect(app.dialog).toBeHidden();
  await expect(app.tabStrip.getByRole('tab', { selected: true })).not.toContainText('unsaved');
});

test('request tabs follow the tab-list pattern: arrow keys, Home and End move between them', async ({ app, page }) => {
  await app.open();
  const newTab = page.getByRole('button', { name: 'New tab' });
  for (const n of [1, 2]) {
    await newTab.click();
    await page.getByRole('menuitem', { name: 'HTTP request' }).click();
    // When a menu closes, Material gives focus back to its button, a moment later. Let that finish, or it can
    // take focus away from the tab while the keys below are being pressed.
    await expect(newTab).toBeFocused();
    await app.url.fill(`${API}/${n}`);
  }
  const tabs = app.tabStrip.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true'); // the screen has caught up with the new tab
  await tabs.nth(2).focus();
  await page.keyboard.press('ArrowRight'); // wraps
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  // Only the selected tab is in the Tab order (roving tabindex).
  await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
  await expect(tabs.nth(2)).toHaveAttribute('tabindex', '0');
});

test('dialogs open with focus inside them, keep focus inside, close with Escape, and give focus back', async ({ app, page }) => {
  await app.open();
  for (const name of ['Settings', 'Import', 'Export', 'Manage']) {
    const trigger = page.getByRole('button', { name, exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(app.dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), { message: `${name}: focus starts inside` }).toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), `${name}: focus stays inside after Tab #${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(app.dialog).toBeHidden();
    await expect(trigger, `${name}: focus returns to the button that opened it`).toBeFocused();
  }
});

test('the confirm dialog puts the safe choice first, so Enter never deletes by accident', async ({ app, page }) => {
  await app.open();
  await app.createCollection('Danger');
  await page.getByRole('button', { name: 'Actions for Danger' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(app.dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(app.dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Collection Danger' })).toBeVisible();
});

test('menus and the sidebar tree work from the keyboard', async ({ app, page }) => {
  await app.open();
  await app.createCollection('Tree');
  const more = page.getByRole('button', { name: 'Actions for Tree' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Run…' })).toBeFocused(); // focus moves into the menu
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(more).toBeFocused();

  const node = page.getByRole('button', { name: 'Collection Tree' });
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(node).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(node).toHaveAttribute('aria-expanded', 'true');
});

test('custom controls show a visible focus indicator', async ({ app, page }) => {
  await app.open();
  await app.createCollection('Focus');
  await app.sendTo(`${API}/json`);
  const targets = [
    app.tabStrip.getByRole('tab').first(),
    page.getByRole('button', { name: 'Collection Focus' }),
    page.getByRole('button', { name: 'Actions for Focus' }),
  ];
  for (const target of targets) {
    await target.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // arrives by keyboard, so :focus-visible applies
    const outline = await target.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  }
});

test('the response panel tabs and the JSON tree can be operated by keyboard', async ({ app, page }) => {
  await app.open();
  await app.sendTo(`${API}/json`);
  await app.responseTab(/^Headers/).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table', { name: 'Response headers' })).toBeVisible();
  await app.responseTab(/^Body/).click();
  await page.getByRole('radiogroup', { name: 'Body view' }).getByRole('radio', { name: 'Tree' }).click();
  const toggle = page.getByRole('region', { name: 'JSON tree' }).getByRole('button', { name: 'Collapse nested' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'JSON tree' }).getByRole('button', { name: 'Expand nested' })).toBeVisible();
});

test('tabs can be closed from the keyboard (Delete) and from the Tab actions menu', async ({ app, page }) => {
  await app.open();
  await page.getByRole('button', { name: 'New tab' }).click();
  await page.getByRole('menuitem', { name: 'HTTP request' }).click();
  await expect(app.tabStrip.getByRole('tab')).toHaveCount(2);
  await app.tabStrip.getByRole('tab').nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(app.tabStrip.getByRole('tab')).toHaveCount(1);

  await page.getByRole('button', { name: 'New tab' }).click();
  await page.getByRole('menuitem', { name: 'HTTP request' }).click();
  await page.getByRole('button', { name: 'Tab actions' }).click();
  await page.getByRole('menuitem', { name: 'Close tab' }).click();
  await expect(app.tabStrip.getByRole('tab')).toHaveCount(1);
});
