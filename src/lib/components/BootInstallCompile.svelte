<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { onDestroy, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { compileOwnerKey, type CompileOwner, type InstallCompileView } from '$lib/boot-install';
  import Urn from './Urn.svelte';
  import BootProvenance from './BootProvenance.svelte';
  let { owner, canManage, impersonating = false, title = t('boot.install.heading', 'Boot prompt') }: { title?: string; owner: CompileOwner; canManage: boolean | null | undefined; impersonating?: boolean } = $props();
  let view = $state<InstallCompileView | null>(null);
  let failed = $state(false);
  let busy = $state(false);
  let notice = $state('');
  let success = $state(false);
  let confirmStart = $state(false);
  let epoch = 0;
  const key = $derived(compileOwnerKey(owner));
  const controls = $derived(canManage === true && !impersonating);
  async function load(stamp: number, expected: string) {
    try {
      const query = new URLSearchParams({ ...owner });
      const r = await fetch(`/app/boot-prompt?${query}`, { signal: AbortSignal.timeout(30_000) });
      const value = await r.json();
      if (epoch !== stamp || key !== expected) return;
      if (!r.ok || value.key !== expected) { failed = true; view = null; return; }
      view = value; failed = false;
    } catch { if (epoch === stamp && key === expected) { failed = true; view = null; } }
  }
  $effect(() => {
    const expected = key;
    const stamp = ++epoch;
    view = null; notice = ''; confirmStart = false; busy = false;
    void untrack(() => load(stamp, expected));
  });
  onDestroy(() => { ++epoch; });
  async function write(intent: 'compile' | 'approve' | 'start') {
    if (!controls || busy) return;
    const stamp = epoch, expected = key;
    const compiled = view?.compiled;
    busy = true; notice = '';
    try {
      const r = await fetch('/app/boot-prompt', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, intent, nodeId: compiled?.id, revision: compiled?.revision }) });
      const result = await r.json();
      if (epoch !== stamp || key !== expected) return;
      if (result.key && result.key !== expected) return;
      success = result.ok === true;
      notice = typeof result.text === 'string' ? result.text : unknownText(intent);
      confirmStart = false;
      await load(stamp, expected);
      if (result.ok === true && epoch === stamp && key === expected) {
        // Refresh the existing pointer panel too. A failed refresh cannot undo a confirmed write.
        try { await invalidateAll(); } catch { /* the local outcome remains confirmed */ }
      }
    } catch {
      if (epoch === stamp && key === expected) { success = false; notice = unknownText(intent); }
    } finally { if (epoch === stamp && key === expected) busy = false; }
  }
  function unknownText(intent: string) { return intent === 'approve' ? t('boot.install.approval-unknown', 'Couldn’t confirm the approval. Reload to check before trying again.') : intent === 'start' ? t('boot.install.source-unknown', 'Could not confirm the source was started. Reload to check before trying again.') : t('boot.install.compile-unknown', 'Couldn’t confirm whether the prompt was built. Reload to check before trying again.'); }
  const button = 'rounded border border-zinc-400 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600';
</script>
<section data-install-compile={key} class="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" aria-label={title}>
  <h3 class="font-semibold">{title}</h3>
  {#if failed}<p role="alert">{t("boot.install.fb477751c1", "Couldn’t read this prompt. Reload before trying again.")}</p>{/if}
  {#if view}
    {#if view.source}
      <div><a class="underline" href={`/app/memories/${encodeURIComponent(view.source.memoryId)}/nodes/${encodeURIComponent(view.source.id)}`}>{view.source.name}</a><div class="mt-1"><Urn value={view.source.urn} type="node" /></div></div>
    {/if}
    {#if controls}
      {#if owner.level === 'app'}<p class="text-sm">{t("boot.install.66d70b0aa7", "This also points the App at the built prompt. Workers without their own prompt, chats and runs then get it once it can be served, which first needs an approved revision, and are refused until then. Workers with their own prompt keep it.")}</p>{/if}
      <button class="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50" disabled={busy} onclick={() => write('compile')}>{busy ? t('boot.install.working', 'Working…') : t('boot.install.update', 'Update the prompt')}</button>
      {#if owner.level === 'worker' && view.canStart}
        <button class={button} disabled={busy} onclick={() => { confirmStart = true; }}>{t("boot.install.c172aa05a5", "Start an empty source for this worker")}</button>
        {#if confirmStart}
          <section class="space-y-2 rounded border border-amber-400 p-3" aria-label={t('boot.install.confirm-source', 'Confirm empty worker source')}>
            <p>{t("boot.install.cb0d3f865e", "This starts an empty source for this worker. Nothing served changes: the worker keeps getting what it gets now until a prompt is built from this source, approved, and the worker is pointed at it.")}</p>
            <button class={button} disabled={busy} onclick={() => write('start')}>{t("boot.install.6d9f0de198", "Start empty source")}</button>
            <button class={button} disabled={busy} onclick={() => { confirmStart = false; }}>{t("boot.install.77dfd2135f", "Cancel")}</button>
          </section>
        {/if}
      {/if}
    {/if}
    {#if view.compiled}
      <p>{t('boot.install.revision', 'Compiled revision {n}', { n: view.compiled.revision })} <Urn value={view.compiled.urn} type="node" /></p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex: scrollable compiled text must be keyboard reachable -->
      <pre tabindex="0" aria-label={t('boot.install.compiled-text', 'Compiled prompt text')} class="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-zinc-300 p-3 text-xs dark:border-zinc-600">{view.compiled.content}</pre>
      {#if view.compiled.lint}<p>{t('boot.install.warnings', 'Warnings ({n})', { n: view.compiled.lint.total })}</p>{#each view.compiled.lint.items as warning}<p class="text-sm">{warning.text}</p>{/each}{#if view.compiled.lint.total > view.compiled.lint.items.length}<p>{t('boot.install.more', '{n} more', { n: view.compiled.lint.total - view.compiled.lint.items.length })}</p>{/if}{/if}
      {#if controls && view.compiled.pending}<button class="rounded bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50" disabled={busy} onclick={() => write('approve')}>{t('boot.install.approve', 'Approve revision {n}', { n: view.compiled.revision })}</button>{/if}
      {#key `${key}:${view.compiled.id}:${view.compiled.revision}`}<BootProvenance nodeId={view.compiled.id} revision={view.compiled.revision} />{/key}
    {/if}
  {/if}
  <p role="status">{success ? notice : ''}</p>
  <p role="alert">{!success ? notice : ''}</p>
</section>
