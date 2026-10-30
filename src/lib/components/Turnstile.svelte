<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { loadTurnstile } from '$lib/turnstile';

  let { resetKey = 0 }: { resetKey?: number } = $props();
  const sitekey = env.PUBLIC_TURNSTILE_SITE_KEY;
  let container = $state<HTMLDivElement>();
  let unavailable = $state(false);
  let resetWidget: (() => void) | undefined;

  $effect(() => { void resetKey; resetWidget?.(); });
  onMount(() => {
    if (!sitekey) return;
    let destroyed = false;
    let dispose: (() => void) | undefined;
    void loadTurnstile().then((api) => {
      if (destroyed || !container) return;
      const id = api.render(container, {
        sitekey,
        'expired-callback': () => { if (!destroyed) api.reset(id); },
        'error-callback': () => { if (!destroyed) unavailable = true; },
      });
      resetWidget = () => { unavailable = false; api.reset(id); };
      dispose = () => api.remove(id);
    }).catch(() => { if (!destroyed) unavailable = true; });
    return () => { destroyed = true; resetWidget = undefined; dispose?.(); };
  });
</script>

{#if sitekey}
  <div class="mt-3" bind:this={container} data-testid="turnstile"></div>
  {#if unavailable}
    <p role="alert" class="mt-2 text-sm text-red-500">{t('auth.checkUnavailable', 'Sign-in is temporarily unavailable. Please try again later.')}</p>
  {/if}
{/if}
