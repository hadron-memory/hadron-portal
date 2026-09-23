/**
 * #879 (@copilot on #890) — how many Task Nodes export checkboxes are still
 * saving.
 *
 * The download plans from the SERVER's stored declarations, so a click on
 * "Download" while a row's save is in flight packages the state from before
 * that click: the box the user just ticked is missing from the zip, with
 * nothing saying so. The download buttons wait for this to reach zero.
 *
 * Module-level because the rows and the download panel are siblings with no
 * shared parent state. On the server it is never touched — `enhance` runs only
 * in the browser — so nothing leaks between requests.
 */
export const exportSaves = $state({ pending: 0 });

export function saveStarted(): void {
  exportSaves.pending += 1;
}

export function saveSettled(): void {
  exportSaves.pending = Math.max(0, exportSaves.pending - 1);
}
