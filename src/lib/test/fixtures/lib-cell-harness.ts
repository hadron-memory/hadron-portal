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
export const LIB_CELL_ROWS = [
  { listKey: 'user:held-workers', prepare: null },
  { listKey: 'memory:assets', prepare: null },
  { listKey: 'memory:assets:delete-confirm', prepare: 'asset-delete-confirm' },
  { listKey: 'node-role-templates:USER', prepare: null },
  { listKey: 'account:grants', prepare: null },
] as const;
export type LibCellRow = (typeof LIB_CELL_ROWS)[number]['listKey'];

const LONG_NAME = 'LongWorkerNameWithFortyUnbrokenCharactersABCD';
const LONG_ROLE = 'a-very-long-role-token-with-no-spaces-in-it-at-all-0123456789';
const LONG_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.macroEnabled.12';
const LONG_UPLOADER = 'UploaderNameWithFortyUnbrokenCharactersABCDEFGH';
const NAME_64 = 'TemplateNameWithSixtyFourUnbrokenCharactersABCDEFGHIJKLMNOPQRSTUV01';
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
      id: `asset-${i}`, memoryId: 'mem-1', urn: `hrn:asset:example.test:fixture:assets:asset-${i}`,
      filename: `report-${i}.xlsm`, mimeType: LONG_MIME, sizeBytes: 2048,
      uploadedAt: '2026-11-21T14:03:00.000Z', uploadedBy: `user-${i}`,
      scanStatus: 'CLEAN' as const, scanSignature: null, description: null, publicUrl: null,
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
    createdAt: time, activatedAt: time, revokedAt: null, allows: true,
    app: { id: 'a1', name: 'Fixture App', urn: 'hrn:app:example.test:fixture' }, appStatus: 'ok',
  }));
  const instance = mount(GrantsPage, { target, props: { data: { grants, user: { id: 'u1' } } } as never });
  return () => unmount(instance);
}

/** The step a row's `prepare` names, run once the table has mounted. */
export async function prepareLibCell(target: HTMLElement, step: string) {
  if (step === 'asset-delete-confirm') {
    const trigger = target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]');
    if (!trigger) throw new Error('lib-rows: the asset row menu trigger is missing');
    trigger.click();
    await new Promise((r) => setTimeout(r, 50));
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => /delete/i.test(b.textContent ?? ''));
    if (!item) throw new Error('lib-rows: the asset Delete menu item is missing');
    item.click();
    await new Promise((r) => setTimeout(r, 50));
    return;
  }
  throw new Error(`lib-rows: unknown prepare step ${step}`);
}
