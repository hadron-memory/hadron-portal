/**
 * #1020: table rows keep their actions in a NodeActionsMenu (⋯), so a test can
 * no longer find "the Delete button" by its text: the item only exists while
 * that row's menu is open.
 *
 * `rowMenuItems(root, 'Delete')` opens every row menu under `root` once, and
 * returns, in row order, one handle per row whose menu OFFERS that item. A
 * handle's `click()` reopens that row's menu and picks the item, which is what
 * a user does. Rows whose menu lacks the item are skipped, so the indices match
 * what the old `buttons.filter(text === 'Delete')[i]` lookups meant.
 */
import { flushSync } from 'svelte';

const ITEM = '[role="menu"] [role="menuitem"]';

function findItem(root: ParentNode, label: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(ITEM)].find((i) => i.textContent?.trim() === label);
}

export function rowMenuItems(root: HTMLElement, label: string): Array<{ click: () => void }> {
  const triggers = [...root.querySelectorAll<HTMLButtonElement>('[data-node-actions] > button[aria-haspopup="menu"]')];
  const handles: Array<{ click: () => void }> = [];
  for (const trigger of triggers) {
    trigger.click(); // open
    flushSync();
    const offered = !!findItem(root, label);
    trigger.click(); // toggle closed again
    flushSync();
    if (!offered) continue;
    handles.push({
      click: () => {
        trigger.click();
        flushSync();
        findItem(root, label)!.click();
        flushSync();
      },
    });
  }
  return handles;
}
