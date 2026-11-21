import { mount } from 'svelte';
import Harness from '$lib/test/DataTableFillHarness.svelte';
import { APP_SHELL_ROW, APP_SHELL_CONTENT } from '$lib/layout/app-shell';

/** The real DataTable in the app shell's own row and content classes (shared with the App layout),
 *  so the browser sees the same scroll ownership the page has. */
export function mountFill(target: HTMLElement, props: { rows: number; headerHeight: number; bounded?: boolean }) {
  const row = document.createElement('div');
  row.className = APP_SHELL_ROW;
  row.dataset.testid = 'shell-row';
  const content = document.createElement('div');
  content.className = APP_SHELL_CONTENT;
  content.dataset.testid = 'shell-content';
  row.append(content);
  target.append(row);
  return mount(Harness, { target: content, props });
}
