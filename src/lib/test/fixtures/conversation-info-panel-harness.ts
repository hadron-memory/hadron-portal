// #2082: mounts the real ConversationInfoPanel for scripts/test-conversation-panel-buttons-layout.mjs.
// A stored start condition and a goal are seeded so Save, Clear and Save goals all render.
import { flushSync, mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import ConversationInfoPanel from '../../components/flow/ConversationInfoPanel.svelte';
import { conversationEntryConditionDefaults, conversationEntryConditionSchema } from '../../flow/conversation-entry-condition-form';
import { conversationMoveDefaults, conversationMoveSchema } from '../../flow/conversation-move-form';
import { conversationGoalsDefaults, conversationGoalsSchema } from '../../flow/conversation-goals-form';
import { addStageDefaults, addStageSchema } from '../../flow/conversation-add-stage-form';

export async function mountPanel(target: HTMLElement, withCondition: boolean): Promise<() => void> {
  const loc = 'conversations:demo';
  const entryCondition = withCondition ? { all: [{ field: 'x', op: 'eq', value: 'y' }] } : null;
  const conversation = {
    id: 'c1', loc, label: 'Demo', isSetup: false, isFallback: false, startOrder: 2, startTotal: 4,
    entryCondition, goalDescriptions: ['Greet'], goalSignals: [], stages: [],
  };
  const props = {
    conversation,
    goalsForm: await superValidate(conversationGoalsDefaults({ loc, goalDescriptions: ['Greet'], goalSignals: [] }, 'mem-1'), zod4(conversationGoalsSchema), { errors: false }),
    goalsSaved: null, goalsError: null,
    addStageForm: await superValidate(addStageDefaults({ loc }, 'mem-1'), zod4(addStageSchema), { errors: false }),
    addStageSaved: null, addStageError: null,
    startConditionForm: await superValidate(conversationEntryConditionDefaults({ loc, entryCondition }, 'mem-1'), zod4(conversationEntryConditionSchema), { errors: false, id: 'conversationEntryCondition' }),
    startConditionSaved: null, startConditionError: null,
    moveForm: await superValidate(conversationMoveDefaults({ loc }, 'mem-1'), zod4(conversationMoveSchema), { errors: false, id: 'conversationMove' }),
    moveError: null, publishState: 'unknown',
    onClose: () => {}, onSelectNode: () => {},
  };
  const panel = mount(ConversationInfoPanel, { target, props: props as never });
  flushSync();
  return () => unmount(panel);
}
