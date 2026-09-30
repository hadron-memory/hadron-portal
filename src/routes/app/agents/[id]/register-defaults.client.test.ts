/**
 * #942 — the agent Settings tab's "Channel attendance" default, mounted.
 *
 * Two things only a mount can show: the help line follows the checkbox as it
 * changes, and the store is re-seeded when a navigation reuses this component
 * for another agent
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage } from '$lib/test/stubs/app-stores';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from './+page.svelte';
import {
  addAgentMemorySchema,
  agentRegisterDefaultsSchema,
  agentSettingsSchema,
  deleteAgentSchema,
  removeAgentMemorySchema,
  updateAgentMemoryRoleSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

function agent(id: string) {
  return {
    id, organizationId: null, urn: `hrn:agent:ada:${id}`, name: `Agent ${id}`, description: null,
    systemPrompt: null, systemMemoryId: null, visibility: 'PERSONAL', type: 'ASSISTANT', surfaces: [],
    personaRole: null, properties: null, hasAiApiKey: false, memoryItems: [], imports: [],
    memoryProvisioning: null, installationPolicy: null, createdAt: '2026-09-01T00:00:00Z',
  };
}

async function pageData(id: string, registerDefaults: { mentionOnly: boolean } | null) {
  return {
    agent: agent(id),
    org: null,
    agentNodes: [],
    installedApps: [],
    bundledAgents: [],
    allOrgs: [],
    orgSystemMemories: [],
    personalMemories: [],
    agentConfigs: [],
    configsError: false,
    currentUserId: 'user-1',
    form: await superValidate(
      { name: `Agent ${id}`, urnSlug: id, description: '', systemPrompt: '', visibility: 'PERSONAL', systemMemoryId: '', personaRole: '' },
      zod4(agentSettingsSchema), { errors: false },
    ),
    registerDefaults,
    registerDefaultsForm: await superValidate(
      { mentionOnly: registerDefaults?.mentionOnly ?? false },
      zod4(agentRegisterDefaultsSchema), { errors: false },
    ),
    addMemoryForm: await superValidate(zod4(addAgentMemorySchema), { errors: false }),
    updateMemoryRoleForm: await superValidate(zod4(updateAgentMemoryRoleSchema), { errors: false }),
    removeMemoryForm: await superValidate(zod4(removeAgentMemorySchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteAgentSchema), { errors: false }),
  };
}

async function mountSettings(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  const settings = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Settings')!;
  settings.click();
  flushSync();
  return m.target;
}

const box = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('form[action="?/updateRegisterDefaults"] input[name="mentionOnly"]');

describe('agent Settings — register default (#942)', () => {
  it('shows the saved default, and the help line follows the checkbox', async () => {
    const root = await mountSettings({ data: await pageData('a', { mentionOnly: true }), form: null });
    expect(box(root)!.checked).toBe(true);
    expect(root.textContent).toContain('New installs count only messages that mention this agent.');

    box(root)!.click();
    flushSync();
    expect(box(root)!.checked).toBe(false);
    expect(root.textContent).toContain('New installs count every message in the default channel.');
  });

  it('a failed read shows "could not load" and offers no control, rather than an unchecked box', async () => {
    const root = await mountSettings({ data: await pageData('a', null), form: null });
    expect(box(root)).toBeNull();
    expect(root.textContent).toContain('The current setting could not be loaded.');
  });

  it('navigating to another agent re-seeds the box, even an edited one: A’s value never posts to B', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click(); // an unsaved edit on A
    flushSync();
    expect(box(root)!.checked).toBe(true);

    props.data = await pageData('b', { mentionOnly: false });
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(false);
  });

  /**
   * SvelteKit's sequence after a successful enhanced submit: invalidateAll
   * re-runs the loader (new `data`), then applyAction puts the action's result
   * on `page.form`, which is where superforms picks it up. Both are replayed.
   */
  async function afterSuccessfulSave(props: Record<string, unknown>, saved: boolean) {
    props.data = await pageData('a', { mentionOnly: saved });
    flushSync();
    await tick();
    const result = await superValidate(
      { _kind: 'registerDefaults', mentionOnly: saved },
      zod4(agentRegisterDefaultsSchema),
    );
    result.message = { type: 'success', text: 'Saved. Future installs use this.' };
    page.update((p) => ({ ...p, status: 200, form: { form: result } }));
    flushSync();
    await tick();
  }

  it('after a successful save the box shows the SAVED value, not the page-load one (#971 QA)', async () => {
    for (const loaded of [false, true]) {
      const props = reactiveProps({ data: await pageData('a', { mentionOnly: loaded }), form: null } as Record<string, unknown>);
      const root = await mountSettings(props);
      box(root)!.click();
      flushSync();
      await afterSuccessfulSave(props, !loaded);
      expect(box(root)!.checked).toBe(!loaded);
      expect(root.textContent).toContain('Saved. Future installs use this.');
      expect(root.textContent).toContain(!loaded
        ? 'New installs count only messages that mention this agent.'
        : 'New installs count every message in the default channel.');
      mounted.pop()!.unmount();
      resetStubPage();
    }
  });

  it('an unsaved change survives a reload caused by another form on the page (#971 Codex P2)', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click(); // edited, not saved
    flushSync();

    // e.g. the Agent form saved: the loader re-reads the SAME agent, default unchanged.
    props.data = await pageData('a', { mentionOnly: false });
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(true);
  });

  it('a clean form still follows the server when the same agent is re-read', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    props.data = await pageData('a', { mentionOnly: true }); // changed elsewhere
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(true);
  });
});
