<script lang="ts">
  import { untrack } from 'svelte';
  import TeamChatThread from './TeamChatThread.svelte';
  import type { ComponentProps } from 'svelte';
  import type { TranscriptView } from '$lib/team-chat-refresh';
  import type { TeamChatMessage } from '$lib/types';
  let { appId, channelId, messages, total, loadError, postForm, form, action, workerUrns, draft, onDraftChange, onSubmittingChange, viewState, onViewStateChange }: {
    appId: string; channelId: string; messages: TeamChatMessage[]; total: number; loadError: boolean;
    postForm: ComponentProps<typeof TeamChatThread>['postForm']; form: unknown; action: string;
    workerUrns: ReadonlyMap<string, string> | null;
    draft?: { body: string; replyToSeq?: string };
    viewState?: TranscriptView;
    onViewStateChange?: (view: TranscriptView) => void;
    onSubmittingChange?: (submitting: boolean) => void;
    onDraftChange: (draft: { body: string; replyToSeq?: string }) => void;
  } = $props();
  // The parent keys this instance by App + Channel. These callbacks keep one
  // stable identity and cannot start polling a newly selected chat mid-await.
  const scopedForm = $derived((form as { form?: { id?: string } } | null)?.form?.id === postForm.id ? form : null);
  const target = untrack(() => ({ appId, channelId }));
  async function read(cursor: string) {
    const res = await fetch(`/app/apps/${encodeURIComponent(target.appId)}/channel-chat?channelRef=${encodeURIComponent(target.channelId)}${cursor}`);
    if (!res.ok) return null;
    const result = await res.json();
    return result.loadFailed ? null : result as { items: TeamChatMessage[]; total: number; loadFailed: boolean };
  }
  const refresh = (seq?: number) => read(seq === undefined ? '' : `&sinceSeq=${seq}`);
  const older = (seq: number) => read(`&beforeSeq=${seq}`);
</script>
<TeamChatThread {messages} {total} {loadError} {postForm} form={scopedForm} {action} {workerUrns}
  {draft} {onDraftChange} {onSubmittingChange} {viewState} {onViewStateChange} onRefresh={refresh} onLoadOlder={older} />
