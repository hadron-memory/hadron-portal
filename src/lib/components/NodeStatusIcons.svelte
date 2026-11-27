<!--
  The node page's approval, mint and signature state as up to three small icons beside the name.

  Each icon is a button that opens a panel with the detail and the controls for that state (the page
  supplies them as snippets, so the forms stay bound to the page's own actions). State is never carried by
  colour alone: a done state is a tinted disc, "not yet" is a bare grey glyph, attention is amber with a dot,
  and every button's accessible name says the state in words.

  A panel shows while the pointer rests on its icon (or on the panel, so its buttons can be reached) and stays
  while pinned by a click or a keypress; the page can pin one too, to show an outcome. Escape and a click outside
  unpin it. The panels stay mounted while shut and are only hidden, so a form inside one is still the page's form
  and a panel that fills in late costs no remount.
-->
<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { CircleCheck, Coins, Signature } from 'lucide-svelte';
  import { t } from '$lib/i18n/t';
  import { approvalText, type ApprovalView } from '$lib/node-approval';
  import type { MintView } from '$lib/node-mint';
  import type { SignaturesView } from '$lib/node-signatures';

  type Kind = 'approval' | 'mint' | 'signature';
  type Look = 'done' | 'attention' | 'none';

  let { approval, mint, signatures, signingOn, approvalPanel, mintPanel, signaturePanel, pinned = $bindable(null) }: {
    /** Null while the approval read is still on its way. */
    approval: ApprovalView | null;
    mint: MintView | null;
    signatures: SignaturesView;
    /** Whether the deployment offers signing: with it off and nothing signed, no signature icon is drawn. */
    signingOn: boolean;
    approvalPanel: Snippet;
    mintPanel: Snippet;
    signaturePanel: Snippet;
    /** The panel held open by a click, or by the page to show an outcome. */
    pinned?: Kind | null;
  } = $props();

  // Resting the pointer on an icon or its panel shows it without a click; a click pins it.
  let hovered = $state<Kind | null>(null);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const open = $derived(hovered ?? pinned);
  let root: HTMLElement | undefined = $state();
  const openers: Partial<Record<Kind, HTMLButtonElement>> = {};

  const approvalLook = $derived<{ look: Look; text: string }>(
    approval === null
      ? { look: 'none', text: t('node.status.approval.loading', 'Loading approval status…') }
      : { look: approval.tone === 'approved' ? 'done' : approval.tone === 'attention' ? 'attention' : 'none', text: approvalText(approval) },
  );
  const mintLook = $derived<{ look: Look; text: string } | null>(
    mint === null || mint.kind === 'none'
      ? null
      : mint.kind === 'minted'
        ? mint.editedSince
          ? { look: 'attention', text: t('node.status.mint.edited', 'Minted, edited since minting') }
          : { look: 'done', text: t('node.mint.minted', 'Minted') }
        // Backfilled and unminted are the quiet states: every ordinary memory is one of them.
        : mint.kind === 'backfilled'
          ? { look: 'none', text: t('node.mint.backfilled', 'Minted (pre-existing)') }
          : { look: 'none', text: t('node.mint.unminted', 'Not minted') },
  );
  const signatureLook = $derived<{ look: Look; text: string } | null>(
    signatures.kind === 'shown'
      ? {
          look: signatures.integrityProblems > 0 || signatures.tone === 'attention' ? 'attention' : signatures.tone === 'signed' ? 'done' : 'none',
          text: signatures.label,
        }
      : signingOn
        ? { look: 'none', text: t('node.status.signature.none', 'Not signed') }
        : null,
  );

  // Each kind has its own hue when done (approval green, mint indigo like the Minted label, signature sky), so two
  // done icons are told apart at a glance as well as by their glyph; attention is amber for all three.
  const DONE: Record<Kind, string> = {
    approval: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    mint: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    signature: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  };
  const discClass = (kind: Kind, look: Look) =>
    look === 'done'
      ? DONE[kind]
      : look === 'attention'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
        : 'text-zinc-400 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800';

  function toggle(kind: Kind) {
    if (pinned === kind) hovered = null; // a click that unpins closes it even under the pointer
    pinned = pinned === kind ? null : kind;
  }
  function shut(returnFocus: boolean) {
    const was = open;
    pinned = null;
    hovered = null;
    const opener = was ? openers[was] : undefined;
    if (returnFocus && opener?.isConnected) opener.focus();
  }
  function enter(kind: Kind) {
    clearTimeout(leaveTimer);
    hovered = kind;
  }
  // A short grace, so the pointer can cross the gap from an icon to its panel.
  function leave() {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => (hovered = null), 200);
  }
  onDestroy(() => clearTimeout(leaveTimer));
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      shut(true);
    }
  }
  function onWindowClick(e: MouseEvent) {
    if (root && !root.contains(e.target as Node)) {
      pinned = null;
      hovered = null; // a tap elsewhere ends a touch "hover", which no mouseleave will
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

{#snippet icon(kind: Kind, state: { look: Look; text: string }, label: string)}
  <button
    type="button"
    bind:this={openers[kind]}
    data-testid="status-icon-{kind}"
    data-look={state.look}
    aria-expanded={open === kind}
    aria-controls="node-status-{kind}"
    aria-label="{label}: {state.text}"
    title="{label}: {state.text}"
    onclick={() => toggle(kind)}
    onmouseenter={() => enter(kind)}
    onmouseleave={leave}
    class="relative inline-flex h-7 w-7 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 pointer-coarse:h-11 pointer-coarse:w-11 {discClass(kind, state.look)}"
  >
    {#if kind === 'approval'}
      <CircleCheck class="h-4 w-4" aria-hidden="true" />
    {:else if kind === 'mint'}
      <Coins class="h-4 w-4" aria-hidden="true" />
    {:else}
      <Signature class="h-4 w-4" aria-hidden="true" />
    {/if}
    {#if state.look === 'attention'}
      <span aria-hidden="true" class="absolute top-0 right-0 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-zinc-950"></span>
    {/if}
  </button>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={root} class="relative inline-flex shrink-0 items-center gap-1" data-testid="node-status-icons" onkeydown={onKeydown}>
  {@render icon('approval', approvalLook, t('node.status.approval', 'Approval'))}
  {#if mintLook}{@render icon('mint', mintLook, t('node.status.mint', 'Mint'))}{/if}
  {#if signatureLook}{@render icon('signature', signatureLook, t('node.status.signature', 'Signature'))}{/if}

  {#each [{ kind: 'approval', body: approvalPanel }, { kind: 'mint', body: mintPanel }, { kind: 'signature', body: signaturePanel }] as panel (panel.kind)}
    <div
      id="node-status-{panel.kind}"
      role="group"
      aria-label={panel.kind === 'approval' ? t('node.status.approval', 'Approval') : panel.kind === 'mint' ? t('node.status.mint', 'Mint') : t('node.status.signature', 'Signature')}
      hidden={open !== panel.kind}
      onmouseenter={() => enter(panel.kind as Kind)}
      onmouseleave={leave}
      class="absolute top-full left-0 z-20 mt-1 w-[min(30rem,calc(100vw-2rem))] space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {@render panel.body()}
    </div>
  {/each}
</div>
