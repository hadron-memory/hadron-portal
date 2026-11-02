<script lang="ts">
  import { setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import TeamChatThread from '$lib/components/TeamChatThread.svelte';
  import type { TeamChatFilter } from '$lib/team-chat-filter';
  // A component-only browser fixture: no auth, server reads or mutation transport.
  setContext('__svelte__', {
    page: writable({ url: new URL('http://localhost/__blank'), params: {}, route: { id: null }, status: 200, error: null, data: {}, form: null }),
    navigating: writable(null), updated: { subscribe: writable(false).subscribe, check: async () => false },
  });
  let announcement = $state('');
  let focusRequest = $state<import('$lib/components/team-chat-thread').TeamChatFilterFocusRequest | null>(null);
  let filter = $state<TeamChatFilter>({ kind: 'none' });
  const postForm = { id: 'chip-layout', valid: false, posted: false, errors: {}, constraints: {}, data: { _kind: 'postTeamChatMessage', body: '' } };
  const messages = [{ nodeId:'layout-message', seq:1, body:'A message with a stored team tag.', at:'2026-11-02T00:00:00Z', authorUserId:null,authorWorkerId:'fixture-worker',authorName:'Example worker',sessionId:null,replyToSeq:null,mentions:[],urn:null,teamTags:[{headId:'fixture-head',label:'team.example'},{headId:'short-head',label:'X'}] }];
</script>
<span data-testid="team-chat-filter-status" class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
{#key JSON.stringify(filter)}
<TeamChatThread onFilterAnnouncement={(text) => { announcement = text; }} bind:filterFocusRequest={focusRequest} {messages} total={1} {filter} postForm={postForm as never} onSelectTeam={(next) => { filter = next; }} heightClass="h-[600px]" pollMs={0} />
{/key}
