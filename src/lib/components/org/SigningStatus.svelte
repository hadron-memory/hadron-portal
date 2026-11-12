<script lang="ts">
  // portal#1921 (R2): one badge and one sentence for the org boot-prompt signing
  // switch. "Required, not enforced" is amber and never styled as enforced: an
  // org must not read as protected where this deployment does not sign.
  import { t } from '$lib/i18n/t';

  let { required, enforced }: { required: boolean; enforced: boolean } = $props();

  const state = $derived(!required ? 'off' : enforced ? 'enforced' : 'not-enforced');
  const badge = $derived(
    state === 'off'
      ? { label: t('org.signing.badge.off', 'Off'), cls: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' }
      : state === 'enforced'
        ? { label: t('org.signing.badge.enforced', 'Required and enforced'), cls: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200' }
        : { label: t('org.signing.badge.not-enforced', 'Required, not enforced'), cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200' },
  );
  const sentence = $derived(
    state === 'off'
      ? t('org.signing.state.off', 'Signing not required. Boot prompts in this organization’s Apps are served once approved.')
      : state === 'enforced'
        ? t('org.signing.state.enforced', 'Signing required. A boot prompt is served here only once it is approved and signed.')
        : t('org.signing.state.not-enforced', 'Signing required, but not enforced: this deployment doesn’t sign boot prompts yet, so approved prompts are still served unsigned.'),
  );
</script>

<div data-signing-state={state}>
  <span class="inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium {badge.cls}">{badge.label}</span>
  <p class="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{sentence}</p>
</div>
