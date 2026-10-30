<!--
  portal#1142 P4 (hadron-server#1602 / #2120) — a worker's signature and commit
  trailer TEMPLATES, on the Briefing tab beside the served briefing, in a
  form of their own.

  - A template is shown exactly as stored; the server fills its variables at
    each bind, so the `{{…}}` text is literal here.
  - A masked template (null) is "not shown", with no editor. The empty string
    is different: a real value that delivers nothing, edited like any other.
  - Seeing the editor promises nothing: there is no per-worker manage signal,
    so the server decides on save and its refusal is shown.
  - No reset or default control, and no client cap (the server's is tunable).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { superForm, type SuperValidated } from 'sveltekit-superforms/client';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { failedSubmission } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { updateSignatureSchema, type UpdateSignatureForm } from './schema';

  let {
    signature,
    trailer,
    retired,
    initialForm,
    actionResult,
  }: {
    signature: string | null | undefined;
    trailer: string | null | undefined;
    retired: boolean;
    initialForm: SuperValidated<UpdateSignatureForm>;
    actionResult: unknown;
  } = $props();

  // #1367: after a successful save the focused Save button is disabled (while
  // the request runs, and again once nothing differs from the stored text), so
  // a keyboard reader's focus fell to the document body. The result line is the
  // stable target: it is the one thing that always exists after a save.
  let resultEl = $state<HTMLElement | null>(null);
  let formEl = $state<HTMLFormElement | null>(null);
  // Kit's applyAction resets focus to the body BEFORE onUpdated runs (a native
  // run saw exactly that), so the active element at that point says nothing
  // about where the reader was. Remember the last element they focused instead.
  let lastFocused: Element | null = null;
  onMount(() => {
    const remember = (e: FocusEvent) => {
      if (e.target instanceof Element) lastFocused = e.target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  });
  async function focusResultAfterSave() {
    await tick();
    // Give focus back to where the reader last was, if that is still a live
    // control other than this form’s submit button (the Save that went away is disabled
    // next, by the re-read); the result line is the fallback. After teardown
    // `bind:this` has nulled the result and the remembered element is detached,
    // so a late result is inert.
    const back = lastFocused;
    if (back instanceof HTMLElement && back.isConnected && back !== resultEl && !(back instanceof HTMLButtonElement && back.type === 'submit' && !!formEl?.contains(back))) {
      back.focus();
      return;
    }
    if (resultEl?.isConnected) resultEl.focus();
  }

  const {
    form: data,
    message: result,
    submitting,
    enhance,
  } = superForm(
    // Only a FAILED submission seeds the editor, so a refusal keeps the
    // reader's text. A successful one must not: the action result outlives a
    // remount (leave and reopen the tab), and seeding from it would put the
    // old saved text over a fresher stored value (Gene's blind P2 on #1157).
    untrack(
      () => (failedSubmission<UpdateSignatureForm>(actionResult, 'updateSignature') as SuperValidated<UpdateSignatureForm> | null) ?? initialForm,
    ),
    {
      validators: zod4Client(updateSignatureSchema),
      validationMethod: 'submit-only',
      resetForm: false,
      invalidateAll: true,
      onUpdated: ({ form }) => {
        if (form.message?.type === 'success') void focusResultAfterSave();
      },
      taintedMessage: t('worker.signature.discard', 'You have unsaved changes to this worker’s signature or trailer. Leave the page and lose them?'),
    },
  );

  // Jane's local P2 on #1157: a same-worker re-read (the loader reruns after
  // any save on this page, or a query-only navigation) changes the stored
  // template under this section, which the worker-id key does not remount.
  // Each field reseeds on its own, against the base the editor was SEEDED
  // from (kept in the form store, never the live prop):
  //  - untouched (value === base), or already equal to the new stored text
  //    (the reader's own save landing): value and base both take the new text;
  //  - a real draft: kept, with its original base. A baseline is never moved
  //    under a retained draft.
  let seen = { signature: untrack(() => signature), trailer: untrack(() => trailer) };
  $effect(() => {
    const next = { signature, trailer };
    untrack(() => {
      for (const field of ['signature', 'trailer'] as const) {
        const stored = next[field];
        if (stored === seen[field]) continue;
        seen = { ...seen, [field]: stored };
        if (stored == null) continue;
        const base = field === 'signature' ? 'signatureBase' : 'trailerBase';
        if ($data[field] === $data[base] || $data[field] === stored) {
          $data[field] = stored;
          $data[base] = stored;
        }
      }
    });
  });

  const readable = $derived({ signature: signature != null, trailer: trailer != null });
  const anyReadable = $derived(readable.signature || readable.trailer);
  const dirty = $derived(
    (readable.signature && $data.signature !== $data.signatureBase) || (readable.trailer && $data.trailer !== $data.trailerBase),
  );
  const fieldClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
</script>

<section data-testid="worker-signature" class="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
  <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('worker.signature.title', 'Signature and trailer')}</h2>

  {#if !anyReadable}
    <p class="text-sm text-zinc-500">{t('worker.signature.not-shown', 'Not shown.')}</p>
  {:else}
    <p class="text-xs text-zinc-500">
      {t(
        'worker.signature.help',
        'Templates. The server fills platform variables when the worker binds, for example {example}. An empty template adds nothing. A change applies from the worker’s next bind.',
        { example: '{{worker.name}}, {{worker.role}}, {{worker.url}}, {{session.llmModel}}' },
      )}
    </p>

    {#if retired}
      <!-- #1367: say why the editors are disabled and Save is absent. States the
           worker's state only; it infers nothing about who could have edited. -->
      <p id="worker-signature-retired" data-testid="signature-retired" class="text-sm text-zinc-600 dark:text-zinc-400">
        {t('worker.signature.retired', 'This worker is retired, so its signature and trailer templates are read-only.')}
      </p>
    {/if}

    <form bind:this={formEl} method="POST" action="?tab=briefing&/updateSignature" use:enhance class="space-y-3" novalidate>
      <input type="hidden" name="_kind" value="updateSignature" />

      {#if readable.signature}
        <input type="hidden" name="signatureBase" value={$data.signatureBase} />
        <div class="space-y-1">
          <label for="workerSignature" class="text-sm font-medium text-zinc-900 dark:text-white">
            {t('worker.signature.signature-label', 'Signature template')}
          </label>
          <textarea id="workerSignature" name="signature" bind:value={$data.signature} disabled={retired} aria-describedby={retired ? 'worker-signature-retired' : undefined} rows="2" spellcheck="false" class={fieldClass}></textarea>
        </div>
      {:else}
        <p class="text-sm text-zinc-500">{t('worker.signature.signature-not-shown', 'Signature template: not shown.')}</p>
      {/if}

      {#if readable.trailer}
        <input type="hidden" name="trailerBase" value={$data.trailerBase} />
        <div class="space-y-1">
          <label for="workerTrailer" class="text-sm font-medium text-zinc-900 dark:text-white">
            {t('worker.signature.trailer-label', 'Trailer template')}
          </label>
          <textarea id="workerTrailer" name="trailer" bind:value={$data.trailer} disabled={retired} aria-describedby={retired ? 'worker-signature-retired' : undefined} rows="2" spellcheck="false" class={fieldClass}></textarea>
        </div>
      {:else}
        <p class="text-sm text-zinc-500">{t('worker.signature.trailer-not-shown', 'Trailer template: not shown.')}</p>
      {/if}

      {#if !retired}
        <button
          type="submit"
          disabled={$submitting || !dirty}
          class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {$submitting ? t('worker.signature.saving', 'Saving…') : t('worker.signature.save', 'Save')}
        </button>
      {/if}

      {#if $result}
        <p
          bind:this={resultEl}
          tabindex="-1"
          role={$result.type === 'error' ? 'alert' : 'status'}
          class="rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 {$result.type === 'error'
            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
            : 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'}"
        >{$result.text}</p>
      {/if}
    </form>
  {/if}
</section>
