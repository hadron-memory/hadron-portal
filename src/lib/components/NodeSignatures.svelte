<!--
  portal#1022 — a node's passkey signatures (hadron-server#1864), display only.

  Renders exactly what `Node.signatureStatus` returns; nothing is derived here
  (see `$lib/node-signatures`). With nothing to report it renders nothing, so
  a node shows no trace of signing while the server keeps it switched off.

  Not a DataTable, deliberately: this is a status line in the node header,
  beside the approval badge, holding the handful of signatures one node
  carries. It has no sorting, searching, columns or paging to offer, and the
  CLAUDE.md table default is for list views.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { integrityProblemsText, signatureStateHint, type SignaturesView, type SignatureTone } from '$lib/node-signatures';
  import Urn from './Urn.svelte';

  let { view }: { view: SignaturesView } = $props();

  function toneClass(tone: SignatureTone): string {
    return tone === 'signed'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
      : tone === 'attention'
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  }
</script>

{#if view.kind === 'shown'}
  <div data-testid="node-signatures" class="mt-1 text-xs">
    <span data-testid="signatures-state" class="rounded-full px-2 py-0.5 font-medium {toneClass(view.tone)}">
      {view.label}
    </span>
    {#if view.rows.length}
      <ul class="mt-1 space-y-0.5" aria-label={t('node.signatures.list-label', 'Signatures')}>
        {#each view.rows as r (r.id)}
          <li data-testid="signature-row" data-state={r.state ?? 'UNKNOWN'} class="flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-500 dark:text-zinc-400">
            <span class="rounded-full px-1.5 font-medium {toneClass(r.tone)}" title={signatureStateHint(r.state) ?? undefined}>{r.label}</span>
            <span>
              {t('node.signatures.detail', 'Revision {rev} signed by {who} on {when}', {
                rev: r.revision,
                who: r.signer,
                when: new Date(r.verifiedAt).toLocaleString(),
              })}
            </span>
            {#if r.signerUrn}
              <Urn value={r.signerUrn} size={9} />
            {/if}
            <span data-testid="signature-passkey">
              · {t('node.signatures.passkey', 'passkey "{label}"', { label: r.passkeyLabel })}
            </span>
            {#if r.passkeyRevokedAt}
              <span data-testid="signature-passkey-revoked" class="text-amber-700 dark:text-amber-300">
                · {t('node.signatures.passkey-revoked', 'passkey revoked on {when}', { when: new Date(r.passkeyRevokedAt).toLocaleString() })}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if view.integrityProblems > 0}
      <p data-testid="signatures-integrity" role="status" class="mt-1 text-red-700 dark:text-red-300">
        {integrityProblemsText(view.integrityProblems)}
      </p>
    {/if}
  </div>
{/if}
