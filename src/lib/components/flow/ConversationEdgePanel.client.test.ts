import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import ConversationEdgePanel from './ConversationEdgePanel.svelte';
import { conversationEdgePanelDefaults, conversationEdgePanelSchema } from '$lib/flow/conversation-edge-panel-form';
import type { ConversationEdgeDetail } from '$lib/flow/conversation-canvas';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function edgeWith(timing: string | null): ConversationEdgeDetail {
  return {
    id: 'e1', name: 'r', sourceId: 's', sourceLabel: 'Intake', targetId: 't', targetLabel: 'Wrap up / Say thanks', targetUrn: 'hrn:node:acme.com:mem:conversations:wrap:thanks',
    priority: 0, condition: null, timing, behavior: null, data: timing ? { timing, custom: 'kept' } : {},
  };
}

async function open(edge: ConversationEdgeDetail) {
  const form = await superValidate(conversationEdgePanelDefaults(edge), zod4(conversationEdgePanelSchema), { errors: false });
  mounted = mountComponent(ConversationEdgePanel as never, { edge, form, saved: false, error: null, onClose: () => {} } as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return mounted.target;
}

const timingSelect = (t: HTMLElement) => t.querySelector<HTMLSelectElement>('#convEdgeTiming')!;
const options = (t: HTMLElement) => [...timingSelect(t).options].map((o) => ({ value: o.value, text: o.textContent ?? '' }));

describe('ConversationEdgePanel timing list (S7, K1)', () => {
  it.each([[null], ['on_complete'], ['always']])('does not offer on_enter for a rule whose timing is %s', async (timing) => {
    const t = await open(edgeWith(timing));
    const values = options(t).map((o) => o.value);
    expect(values).toContain('on_complete');
    expect(values).toContain('always');
    expect(values).not.toContain('on_enter');
  });

  it('keeps an existing on_enter rule visible as "not available yet", selected, and written back on Save', async () => {
    const t = await open(edgeWith('on_enter'));
    const entry = options(t).find((o) => o.value === 'on_enter');
    expect(entry?.text).toMatch(/not available yet; kept as is/i);
    expect(timingSelect(t).value).toBe('on_enter');
    await tick(3);
    const data = JSON.parse(t.querySelector<HTMLInputElement>('input[name="data"]')!.value);
    expect(data).toMatchObject({ timing: 'on_enter', custom: 'kept' });
  });

  it('shows a stage target as "conversation / stage" with its URN chip', async () => {
    const t = await open(edgeWith(null));
    expect(t.textContent).toContain('Wrap up / Say thanks');
    expect(t.textContent).toContain('conversations:wrap:thanks');
  });
});
