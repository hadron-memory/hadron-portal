// portal#2492 (#1962 slice 6): the browser-check rows of the issue, mounted as the real components with legal
// synthetic data for the Chromium containment harness (kind "lib-rows"). #2486 measured none of them, and its
// gate amendment hands them to this slice's own QA browser seat, so each is MEASURED here at both widths and in
// both themes: a row that escapes is fixed in this PR, a row that does not stays as it is. No API, no
// production data: the two rows that fetch (BootProvenance, TeamChatSearch) are answered by a stub fetch.
import { mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import AgentExtendedBy from '$lib/components/AgentExtendedBy.svelte';
import BootProvenance from '$lib/components/BootProvenance.svelte';
import SkillExportLeftOutTable from '$lib/components/SkillExportLeftOutTable.svelte';
import TeamChatSearch from '$lib/components/TeamChatSearch.svelte';
import WorklogTable from '$lib/components/WorklogTable.svelte';
import ActionRegisterList from '$lib/components/action-register/ActionRegisterList.svelte';
import RulebookManager from '$lib/components/memory-config/RulebookManager.svelte';
import TemplatesManager from '$lib/components/memory-config/TemplatesManager.svelte';
import MintBlockersTable from '$lib/components/memory/MintBlockersTable.svelte';
import RegisterPanel from '$lib/components/register/RegisterPanel.svelte';
import AccessCheckPage from '../../../routes/app/commands/access-check/+page.svelte';
import { accessCheckSchema } from '../../../routes/app/commands/access-check/schema';
import { addAttendanceSchema, editAttendanceSchema, removeAttendanceSchema } from '$lib/register/schema';

// `prepare` names a step a reader performs before the cell exists (a search, opening a template draft).
export const BROWSER_CELL_ROWS = [
  { listKey: 'agent-detail-extended-by', prepare: null, expect: 'tbody a[href^="/app/agents/"]' },
  { listKey: 'boot-prompt-provenance', prepare: null, expect: 'tbody td' },
  { listKey: 'orgs:tasks:export-left-out', prepare: null, expect: 'tbody td' },
  { listKey: 'app-team-chat-search', prepare: null, expect: 'tbody [data-nodeid]' },
  { listKey: 'worklog:fixture', prepare: null, expect: 'tbody td' },
  { listKey: 'action-register:fixture', prepare: null, expect: '[data-testid="register-code"]' },
  { listKey: 'memory-node-role-rules', prepare: null, expect: 'tbody button:has-text("Edit")' },
  { listKey: 'template-draft-rules', prepare: 'template-draft', expect: '[aria-label="Template editor"] tbody td' },
  { listKey: 'memories:mint:blockers', prepare: null, expect: 'tbody td' },
  { listKey: 'app:register', prepare: null, expect: 'tbody td' },
  { listKey: 'commands:access-check:grants', prepare: null, expect: '[data-testid="access-check-grant-row"]' },
] as const;
export type BrowserCellRow = (typeof BROWSER_CELL_ROWS)[number]['listKey'];
export const isBrowserCellRow = (row: string): row is BrowserCellRow => BROWSER_CELL_ROWS.some((r) => r.listKey === row);

// Built by construction: each is longer than any column and has no break opportunity. The exact length is not
// the contract; being longer than the cell is. A name is capped at 64 characters, a loc and a handle are not.
const NAME_64 = `LongUnbrokenName${'A'.repeat(48)}`;
const TOKEN = `a-token-with-no-spaces-${'0123456789'.repeat(7)}`;
const SLUG = `long-slug-${'s'.repeat(50)}`;
const time = '2026-11-01T02:04:36Z';
const URN = (kind: string, tail: string) => `hrn:${kind}:example.test:${SLUG}:${tail}`;

const ruleOf = (role: string, i: number) => ({
  id: `r${i}`, role, revision: 1, enabled: true, strictSubRoles: true, writers: 'OWNER' as const, validateBy: 'AGENT' as const, locked: false,
  authorTask: URN('node', `tasks:${TOKEN}`), authorTaskId: `at${i}`, authorTaskState: 'OK' as const,
  validationTask: null, validationTaskId: null, validationTaskState: 'NONE' as const,
  descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE' as const, sourceTemplate: null,
});

type Cleanup = () => void;
// A mount that has to await (a superform) hands back its cleanup at once and unmounts when the work lands.
function lazily(start: () => Promise<Cleanup>): Cleanup {
  let stop: Cleanup | null = null, stopped = false;
  void start().then((c) => { if (stopped) c(); else stop = c; });
  return () => { stopped = true; stop?.(); };
}
const stubFetch = (answer: unknown) => {
  const original = window.fetch;
  window.fetch = (async () => new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  return () => { window.fetch = original; };
};

export function mountBrowserCell(target: HTMLElement, row: BrowserCellRow): Cleanup {
  if (row === 'agent-detail-extended-by') {
    const items = [0, 1].map((i) => ({ id: `ag${i}`, name: `${NAME_64}${i}`, urn: URN('agent', `${TOKEN}${i}`) }));
    const instance = mount(AgentExtendedBy, { target, props: { agentId: 'ag-self', result: { items, endCursor: null, hasMore: false, failed: false } } });
    return () => unmount(instance);
  }
  if (row === 'boot-prompt-provenance') {
    const items = [0, 1].map((i) => ({
      name: `${NAME_64}${i}`, urn: URN('node', `${TOKEN}${i}`), omitted: false, kind: `a-long-occurrence-kind-${'k'.repeat(40)}`, order: i, depth: 2, revNo: 3,
      selection: { rev: null, approved: true, signed: true }, pruned: false,
    }));
    const restore = stubFetch({ page: { items, total: 2, hasMore: false, pruned: false, offset: 0 } });
    const instance = mount(BootProvenance, { target, props: { nodeId: 'n1', revision: 3, linkSources: true } });
    return () => { unmount(instance); restore(); };
  }
  if (row === 'orgs:tasks:export-left-out') {
    const rows = [0, 1].map((i) => ({ name: `${NAME_64}${i}`, urn: URN('node', `tasks:${TOKEN}${i}`), reason: `${TOKEN}-${TOKEN}` }));
    const instance = mount(SkillExportLeftOutTable, { target, props: { rows } });
    return () => unmount(instance);
  }
  if (row === 'app-team-chat-search') {
    const items = [0, 1].map((i) => ({
      nodeId: `m${i}`, urn: URN('node', `chats:team:${TOKEN}${i}`), seq: 100 + i, channelId: 'c1', channelIncarnation: 1,
      body: `${TOKEN}${TOKEN} an unbroken message body`, at: time, authorName: `${NAME_64}${i}`,
    }));
    const restore = stubFetch({ ok: true, items, complete: true, cursor: null, channelId: 'c1', channelIncarnation: 1 });
    const instance = mount(TeamChatSearch, { target, props: { appId: 'app-1' } });
    // The table exists only after a search, and the harness waits for a cell before it prepares: search here.
    void (async () => {
      const input = await until(() => target.querySelector<HTMLInputElement>('#team-chat-search-input'), 'the chat search input');
      input.value = 'needle'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 16));
      input.form?.requestSubmit();
    })().catch(() => {});
    return () => { unmount(instance); restore(); };
  }
  if (row === 'worklog:fixture') {
    const items = [0, 1].map((i) => ({
      nodeId: `w${i}`, sessionId: `s${i}`, workerName: `${NAME_64}${i}`, workerId: i === 0 ? `wk${i}` : null, tool: 'github', kind: 'pr',
      ref: `example-org/${SLUG}#${1000 + i}`, action: `merged-${'x'.repeat(40)}`, at: time, detail: { title: `${TOKEN}${TOKEN}`, url: `https://example.test/${TOKEN}` }, model: `claude-${'m'.repeat(40)}`,
    }));
    const instance = mount(WorklogTable, { target, props: { items, total: 2, listKey: 'worklog:fixture', showFilters: false } as never });
    return () => unmount(instance);
  }
  if (row === 'action-register:fixture') {
    const entries = [0, 1].map((i) => ({ code: `${TOKEN}.${i}`, state: 'MAPPED', taskLoc: `tasks:${TOKEN}${i}`, taskUrn: URN('node', `tasks:${TOKEN}${i}`), definedBy: URN('agent', TOKEN) }));
    const instance = mount(ActionRegisterList, { target, props: { page: { entries, total: 2, hasMore: false }, offset: 0, limit: 20, hrefFor: (o: number) => `?offset=${o}`, listKey: 'action-register:fixture' } as never });
    return () => unmount(instance);
  }
  if (row === 'memory-node-role-rules') {
    const initial = { id: 'config', rules: [0, 1].map((i) => ruleOf(`${TOKEN}-${i}`, i)) };
    const instance = mount(RulebookManager, { target, props: { initial, memoryRef: 'memory', readOnly: false, memories: [], memoriesFailed: false } as never });
    return () => unmount(instance);
  }
  if (row === 'template-draft-rules') {
    const templates = [{ id: 't0', name: NAME_64, description: 'd', required: false, revision: 1, rules: [0, 1].map((i) => ruleOf(`${TOKEN}-${i}`, i)) }];
    const instance = mount(TemplatesManager, { target, props: { initial: templates, ownerType: 'USER', ownerRef: 'fixture-user', readOnly: false, canManage: true, memories: [], memoriesFailed: false } as never });
    return () => unmount(instance);
  }
  if (row === 'memories:mint:blockers') {
    const rows = [0, 1].map((i) => ({ id: `b${i}`, kindText: `a-long-blocker-kind-${'k'.repeat(50)}`, loc: `${TOKEN}:${TOKEN}${i}`, urn: i === 0 ? URN('node', `${TOKEN}${i}`) : null, detail: URN('node', `cited:${TOKEN}`), detailIsUrn: i === 0 }));
    const instance = mount(MintBlockersTable, { target, props: { rows } });
    return () => unmount(instance);
  }
  if (row === 'app:register') {
    return lazily(async () => {
      const channel = { id: 'ch-0', name: `${NAME_64}`, loc: `chats:${TOKEN}`, chatRootUrn: URN('node', `chats:${TOKEN}`) };
      const rows = [0, 1].map((i) => ({
        id: `re${i}`, ownerType: 'APP' as const, ownerId: 'app-1', appId: 'app-1', organizationId: null, channelId: 'ch-0', channel,
        attendeeWorkerId: `wk${i}`, attendeeAgentId: null, attendeeUrn: URN('worker', `${TOKEN}${i}`), role: 'BOTH' as const, mentionOnly: true, installDefault: false,
        description: `${TOKEN}${TOKEN}`, createdAt: time, editable: true, inherited: false,
      }));
      const props = {
        rows, ownerType: 'APP', ownerId: 'app-1', canManage: true, channels: [{ ...channel, description: null, kind: 'CHAT', chatRootNodeId: 'root', lastSeq: 1, lastMessageAt: null, createdAt: time, memoryId: 'm', memory: null }],
        attendees: [{ id: 'wk0', name: NAME_64, urn: URN('worker', TOKEN), kind: 'worker' }], actionData: null, listKey: 'app:register',
        addForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
        editForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
        removeForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
      };
      const instance = mount(RegisterPanel, { target, props: props as never });
      return () => unmount(instance);
    });
  }
  // commands:access-check:grants
  return lazily(async () => {
    const form = await superValidate(zod4(accessCheckSchema), { errors: false });
    const result = {
      user: { id: 'u1', handle: 'someone', name: null, email: null }, resourceUrn: URN('mem', 'x'), resourceKind: 'MEMORY', role: 'ADMIN',
      canRead: true, canWrite: true, canManage: true, canDelete: false,
      grants: [0, 1].map((i) => ({ source: `${TOKEN}:${TOKEN}${i}`, role: `a-long-role-${'r'.repeat(40)}`, via: URN('org', `${TOKEN}${i}`) })),
    };
    const instance = mount(AccessCheckPage, { target, props: { form: { form, result }, data: { form, prefill: { user: '', resource: '' } } } as never });
    return () => unmount(instance);
  });
}

/** Poll for a value instead of sleeping: a fixed delay flakes on a slow runner. */
async function until<T>(read: () => T | undefined | null, what: string): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = read();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 16));
  }
  throw new Error(`lib-rows: ${what} never appeared`);
}

export async function prepareBrowserCell(target: HTMLElement, step: string) {
  if (step === 'template-draft') {
    const edit = await until(() => [...target.querySelectorAll<HTMLButtonElement>('tbody button')].find((b) => b.textContent?.trim() === 'Edit'), 'the template Edit button');
    edit.click();
    await until(() => target.querySelector('[aria-label="Template editor"] tbody td'), 'the draft rules table');
    return;
  }
  throw new Error(`lib-rows: unknown prepare step ${step}`);
}
