/**
 * S7 (portal#2064): the "Start" section of the conversation panel — order
 * buttons, entry-condition builder, publish note (B5) and its scope guard (Q15).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import ConversationInfoPanel from './ConversationInfoPanel.svelte';
import { conversationEntryConditionDefaults, conversationEntryConditionSchema } from '$lib/flow/conversation-entry-condition-form';
import { conversationMoveDefaults, conversationMoveSchema } from '$lib/flow/conversation-move-form';
import { conversationGoalsDefaults, conversationGoalsSchema } from '$lib/flow/conversation-goals-form';
import { addStageDefaults, addStageSchema } from '$lib/flow/conversation-add-stage-form';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

type Over = Partial<{
  isSetup: boolean; isFallback: boolean; startOrder: number | null; startTotal: number | null;
  entryCondition: unknown; publishState: 'yes' | 'no' | 'unknown'; moveError: string | null;
}>;

async function open(over: Over = {}) {
  const loc = 'conversations:demo';
  const entryCondition = 'entryCondition' in over ? over.entryCondition : null;
  const conversation = {
    id: 'c1', loc, label: 'Demo', isSetup: over.isSetup ?? false, isFallback: over.isFallback ?? false,
    startOrder: 'startOrder' in over ? over.startOrder! : 2, startTotal: 'startTotal' in over ? over.startTotal! : 4,
    entryCondition, goalDescriptions: [], goalSignals: [], stages: [],
  };
  const props = {
    conversation,
    goalsForm: await superValidate(conversationGoalsDefaults({ loc, goalDescriptions: [], goalSignals: [] }, 'mem-1'), zod4(conversationGoalsSchema), { errors: false }),
    goalsSaved: null, goalsError: null,
    addStageForm: await superValidate(addStageDefaults({ loc }, 'mem-1'), zod4(addStageSchema), { errors: false }),
    addStageSaved: null, addStageError: null,
    startConditionForm: await superValidate(conversationEntryConditionDefaults({ loc, entryCondition }, 'mem-1'), zod4(conversationEntryConditionSchema), { errors: false, id: 'conversationEntryCondition' }),
    startConditionSaved: null, startConditionError: null,
    moveForm: await superValidate(conversationMoveDefaults({ loc }, 'mem-1'), zod4(conversationMoveSchema), { errors: false, id: 'conversationMove' }),
    moveError: over.moveError ?? null,
    publishState: over.publishState ?? 'unknown',
    onClose: () => {}, onSelectNode: () => {},
  };
  mounted = mountComponent(ConversationInfoPanel as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return mounted.target;
}

const move = (t: HTMLElement, label: string) =>
  t.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe('Start section', () => {
  it('is absent for a setup or fallback conversation (Q13)', async () => {
    for (const over of [{ isSetup: true, startOrder: null, startTotal: null }, { isFallback: true, startOrder: null, startTotal: null }]) {
      const t = await open(over);
      expect(t.textContent).not.toContain('Start order');
      expect(t.querySelector('#convStartHeading')).toBeNull();
      mounted?.unmount();
    }
  });

  it('says "Start order: 2 of 4" with Move earlier and Move later', async () => {
    const t = await open();
    expect(t.textContent).toContain('Start order: 2 of 4');
    expect(move(t, 'Move earlier')?.getAttribute('aria-disabled')).toBeNull();
    expect(move(t, 'Move later')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('uses aria-disabled, not disabled, at both ends so focus is not dropped', async () => {
    const first = await open({ startOrder: 1 });
    expect(move(first, 'Move earlier')?.getAttribute('aria-disabled')).toBe('true');
    expect(move(first, 'Move earlier')?.disabled).toBe(false);
    expect(move(first, 'Move later')?.getAttribute('aria-disabled')).toBeNull();
    mounted?.unmount();
    const last = await open({ startOrder: 4 });
    expect(move(last, 'Move later')?.getAttribute('aria-disabled')).toBe('true');
    expect(move(last, 'Move later')?.disabled).toBe(false);
  });

  it('swallows a click on a disabled end instead of posting', async () => {
    const t = await open({ startOrder: 1 });
    const btn = move(t, 'Move earlier')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('shows "Only conversation" and no buttons when it is the only one', async () => {
    const t = await open({ startOrder: 1, startTotal: 1 });
    expect(t.textContent).toContain('Only conversation');
    expect(move(t, 'Move earlier')).toBeNull();
  });

  it('shows a refused move beside the control as an alert', async () => {
    const t = await open({ moveError: 'Start order was only partly saved, so the order shown may be out of date. Reload it, then try again.' });
    expect(t.querySelector('[role="alert"]')?.textContent).toContain('only partly saved');
  });
});

describe('entry condition', () => {
  it('leads with "Starts a chat when:" and reads "Always" when none is set', async () => {
    const t = await open();
    expect(t.textContent).toContain('Starts a chat when:');
    expect(t.textContent).toContain('Always');
    expect(t.querySelector('button[value="clear"]')).toBeNull();
  });

  it('offers Save, and Clear only once a condition is stored', async () => {
    const t = await open({ entryCondition: { '==': [{ var: 'memory.a' }, 1] } });
    expect(t.querySelector('button[value="save"]')?.textContent).toContain('Save');
    expect(t.querySelector('button[value="clear"]')?.textContent).toContain('Clear');
  });

  it('offers no chat.* or message.data.* variable in the builder', async () => {
    const t = await open({ entryCondition: { '==': [{ var: 'memory.a' }, 1] } });
    const options = [...t.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter((v) => v.startsWith('chat.') || v.startsWith('message.'))).toEqual([]);
    expect(options).toContain('agent.config.confidence_threshold');
  });

  it('shows a condition the builder cannot represent read-only and posts it back unchanged', async () => {
    const odd = { '+': [1, 2] };
    const t = await open({ entryCondition: odd });
    expect(t.textContent).toContain("can't edit");
    await tick(3);
    expect(JSON.parse(t.querySelector<HTMLInputElement>('input[name="condition"]')!.value)).toEqual(odd);
  });
});

describe('publish note (B5)', () => {
  it('says new chats keep the published version only when one is known to exist', async () => {
    const t = await open({ publishState: 'yes' });
    expect(t.textContent).toContain('New chats keep using the published version until you publish again.');
  });

  it('says nothing for an Agent known to have no published version', async () => {
    const t = await open({ publishState: 'no' });
    expect(t.textContent).not.toMatch(/publish/i);
  });

  it('is conditional when the portal does not know, and never promises "after you publish"', async () => {
    const t = await open({ publishState: 'unknown' });
    expect(t.textContent).toContain('If this Agent has a published version');
    for (const state of ['yes', 'unknown'] as const) {
      mounted?.unmount();
      expect((await open({ publishState: state })).textContent).not.toMatch(/after you publish/i);
    }
  });

  it('puts no publish note on the order control', async () => {
    const t = await open({ publishState: 'yes' });
    const orderForm = t.querySelector('form[action="?/moveConversation"]')!;
    expect(orderForm.textContent).not.toMatch(/publish/i);
  });
});

describe('results the server answers with', () => {
  const stored = { '==': [{ var: 'memory.a' }, 1] };

  it('a confirmed Clear empties the builder so the next Save cannot restore the old condition', async () => {
    const t = await open({ entryCondition: stored });
    const form = t.querySelector<HTMLFormElement>('form[action="?/updateEntryCondition"]')!;
    const input = () => t.querySelector<HTMLInputElement>('input[name="condition"]')!;
    expect(JSON.parse(input().value)).toEqual(stored);
    const posted = { id: 'conversationEntryCondition', valid: true, errors: {}, posted: true, data: { systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: JSON.stringify(stored), intent: 'clear' }, message: { type: 'success', text: 'Cleared.' } };
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: posted } });
    await tick(5);
    expect(JSON.parse(input().value)).toBeNull();
  });

  it('a Save result leaves the edited condition in place', async () => {
    const t = await open({ entryCondition: stored });
    const form = t.querySelector<HTMLFormElement>('form[action="?/updateEntryCondition"]')!;
    const posted = { id: 'conversationEntryCondition', valid: true, errors: {}, posted: true, data: { systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: JSON.stringify(stored), intent: 'save' }, message: { type: 'success', text: 'Saved.' } };
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: posted } });
    await tick(5);
    expect(JSON.parse(t.querySelector<HTMLInputElement>('input[name="condition"]')!.value)).toEqual(stored);
  });

  it('a failed reorder reloads the stored order itself, a success leaves that to superforms', async () => {
    resetNavigationCalls();
    const t = await open();
    const form = t.querySelector<HTMLFormElement>('form[action="?/moveConversation"]')!;
    const data = { id: 'conversationMove', valid: true, errors: {}, posted: true, data: {}, message: { type: 'error', text: 'partly saved' } };
    await submitEnhancedWithResult(form, { type: 'failure', status: 500, data: { form: data } });
    await tick(5);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
  });

  it('applies a failed reorder\'s message only after the reload has finished', async () => {
    resetNavigationCalls();
    const t = await open();
    const form = t.querySelector<HTMLFormElement>('form[action="?/moveConversation"]')!;
    let reloaded = false;
    navigationHooks.onInvalidateAll = async () => { await wait(20); reloaded = true; };
    const data = { id: 'conversationMove', valid: true, errors: {}, posted: true, data: {}, message: { type: 'error', text: 'partly saved' } };
    await submitEnhancedWithResult(form, { type: 'failure', status: 500, data: { form: data } });
    expect(reloaded).toBe(true);
  });
});
