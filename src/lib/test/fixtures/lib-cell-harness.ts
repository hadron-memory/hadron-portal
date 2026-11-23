// portal#2492 (#1962 slice 6): the real lib/route tables the issue lists as LIKELY AFFECTED, with legal
// synthetic rows, for the Chromium containment harness (scripts/test-table-cell-overflow-layout.mjs, kind
// "lib-rows"). No API, no production data. Every value is within its contract: a worker name and role are
// free text, a template name is up to 64 characters (maxlength on its field) and its description is
// unbounded, a grant's action/reason/values are free text and JSON, and a MIME type is whatever the
// uploader's browser sent (vendor types run past 70 characters).
import { mount, unmount } from 'svelte';
import HeldWorkersTable from '$lib/components/HeldWorkersTable.svelte';
import AssetTable from '$lib/components/assets/AssetTable.svelte';
import TemplatesManager from '$lib/components/memory-config/TemplatesManager.svelte';
import GrantsPage from '../../../routes/app/account/grants/+page.svelte';

/**
 * The rows of #2492 this PR fixes, by listKey. `prepare` names a step a reader performs before the
 * cell exists (an inline confirm replaces the Actions cell content).
 */
// `anywhereColumns` names the FREE-TEXT cells of a row, which must keep `overflow-wrap:anywhere`: a column id
// that stops matching the component's allow-list would silently drop it (blind delta, #2515), and the
// battery fails on the computed style, not the class name.
// `dateColumns` names the DATE cells of a row: they must wrap at their spaces and never split a token
// (blind review, #2515), checked by the battery with the column narrowed below one token.
export const LIB_CELL_ROWS = [
  { listKey: 'user:held-workers', prepare: null, anywhereColumns: [] as string[], dateColumns: [] as string[], expect: 'tbody a[href^="/app/workers/"]' },
  { listKey: 'memory:assets', prepare: null, anywhereColumns: ['mimeType'], dateColumns: ['uploaded'], expect: 'tbody button[aria-label^="Actions for"]' },
  { listKey: 'memory:assets:delete-confirm', prepare: 'asset-delete-confirm', anywhereColumns: [] as string[], dateColumns: [] as string[], expect: 'tbody button:has-text("Cancel")' },
  // The widest cell of this table, the four-button Actions cell, only renders for a writable owner.
  { listKey: 'node-role-templates:USER', prepare: null, anywhereColumns: ['name', 'description'], dateColumns: [] as string[], expect: 'tbody button:has-text("Apply to several memories")' },
  { listKey: 'account:grants', prepare: null, anywhereColumns: ['action', 'reason', 'values'], dateColumns: ['createdAt', 'activatedAt', 'startsAt', 'expiresAt', 'revokedAt'], expect: 'tbody [data-testid="my-grant-row"]' },
] as const;
export type LibCellRow = (typeof LIB_CELL_ROWS)[number]['listKey'];

// Built by construction, not hand-counted (blind review, #2515): each is long enough to overflow its
// column unbroken. The exact length is not the contract; being longer than the cell is.
const LONG_NAME = `LongWorkerName${'A'.repeat(40)}`;
const LONG_ROLE = `a-long-role-token-${'x'.repeat(42)}`;
const LONG_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.macroEnabled.12';
const LONG_UPLOADER = `Uploader${'B'.repeat(40)}`;
// The File cell shows the asset's URN chip and a description line, the Memory cell the memory's URN chip: a long
// memory slug lengthens both chips, and a long description exercises the truncate-with-title line (portal#2516).
const LONG_MEMORY = `long-memory-slug-${'m'.repeat(50)}`;
const LONG_DESCRIPTION = `a long asset description with a spaceless tail ${'d'.repeat(60)}`;
const NAME_64 = `Template${'C'.repeat(56)}`;
const TOKEN = 'a-description-token-with-no-spaces-0123456789-0123456789-0123456789';
const time = '2026-11-01T02:04:36Z';

export function mountLibCell(target: HTMLElement, row: LibCellRow) {
  if (row === 'user:held-workers') {
    const workers = [0, 1].map((i) => ({ id: `w${i}`, name: `${LONG_NAME}${i}`, urn: `hrn:worker:example.test:fixture:w${i}`, role: LONG_ROLE, appId: 'a1', appUrn: 'hrn:app:example.test:fixture', heldAt: time, hasLiveSession: i === 0, lastActiveAt: time }));
    const instance = mount(HeldWorkersTable, { target, props: { workers } });
    return () => unmount(instance);
  }
  if (row === 'memory:assets' || row === 'memory:assets:delete-confirm') {
    const assets = [0, 1].map((i) => ({
      id: `asset-${i}`, memoryId: 'mem-1', urn: `hrn:asset:example.test:${LONG_MEMORY}:assets:asset-${i}`,
      filename: `report-${i}${'f'.repeat(60)}.xlsm`, mimeType: LONG_MIME, sizeBytes: 2048,
      uploadedAt: '2026-11-21T14:03:00.000Z', uploadedBy: `user-${i}`,
      scanStatus: 'CLEAN' as const, scanSignature: null, description: LONG_DESCRIPTION, publicUrl: null,
      publicLinkEnabled: false, canManagePublicLink: false, publicLinkAvailable: false,
    }));
    const instance = mount(AssetTable, { target, props: { assets, showMemory: true, uploaderNames: { 'user-0': LONG_UPLOADER, 'user-1': LONG_UPLOADER } } as never });
    return () => unmount(instance);
  }
  if (row === 'node-role-templates:USER') {
    const templates = [0, 1].map((i) => ({ id: `t${i}`, name: `${NAME_64}`, description: TOKEN, required: false, revision: 1, rules: [] }));
    const instance = mount(TemplatesManager, { target, props: { initial: templates, ownerType: 'USER', ownerRef: 'fixture-user', readOnly: false, canManage: true, memories: [], memoriesFailed: false } as never });
    return () => unmount(instance);
  }
  const grants = [0, 1].map((i) => ({
    id: `g${i}`, appId: 'a1', action: 'a.very.long.grant.action.name.with.no.spaces.at.all.0123456789', holderKind: 'USER', holderId: 'u1',
    values: { scope: 'a-long-unbroken-value-0123456789', hosts: ['host-0123456789-0123456789', 'another-host-0123456789'] },
    reason: 'a-reason-token-with-no-spaces-0123456789-0123456789-0123456789', startsAt: time, expiresAt: time, maxUses: null, useCount: i,
    createdAt: time, activatedAt: time, revokedAt: time, allows: true,
    app: { id: 'a1', name: 'Fixture App', urn: 'hrn:app:example.test:fixture' }, appStatus: 'ok',
  }));
  const instance = mount(GrantsPage, { target, props: { data: { grants, user: { id: 'u1' } } } as never });
  return () => unmount(instance);
}

/** Poll for a value instead of sleeping: a fixed delay flakes on a slow runner. */
async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = read();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 16));
  }
  throw new Error(`lib-rows: ${what} never appeared`);
}

/** The step a row's `prepare` names, run once the table has mounted. */
export async function prepareLibCell(target: HTMLElement, step: string) {
  if (step === 'asset-delete-confirm') {
    const trigger = target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]');
    if (!trigger) throw new Error('lib-rows: the asset row menu trigger is missing');
    trigger.click();
    const item = await until(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => /delete/i.test(b.textContent ?? '')), 'the asset Delete menu item');
    item.click();
    return;
  }
  throw new Error(`lib-rows: unknown prepare step ${step}`);
}
