<script lang="ts" module>
  interface TurnstileApi {
    render: (el: HTMLElement, opts: { sitekey: string; theme: 'auto' }) => string;
    reset: (id: string) => void;
    remove: (id: string) => void;
  }
  declare global {
    interface Window {
      turnstile?: TurnstileApi;
    }
  }

  const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let scriptReady: Promise<TurnstileApi> | null = null;

  /** One shared load of Cloudflare's script, however many forms mount. */
  function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    scriptReady ??= new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
      script.onerror = () => {
        scriptReady = null; // let a later mount try again
        reject(new Error('turnstile script failed to load'));
      };
      document.head.appendChild(script);
    });
    return scriptReady;
  }
</script>

<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';

  /**
   * #1470 — the Cloudflare Turnstile check for an email sign-in form (R210,
   * `hrn:node:hadronmemory.com:specs:cor:aut:030:01`). Rendered inside the `<form>`: Cloudflare adds the hidden
   * `cf-turnstile-response` input to the closest form itself, so the token
   * posts with the rest of it.
   *
   * With `PUBLIC_TURNSTILE_SITE_KEY` unset nothing renders and nothing loads,
   * which keeps the form exactly as it was.
   *
   * A token is good for one verification, so the form calls `reset()` after
   * every submit, whether or not it succeeded.
   */
  const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY;

  let container: HTMLDivElement | undefined = $state();
  let api: TurnstileApi | undefined;
  let widgetId: string | undefined;

  export function reset() {
    if (api && widgetId !== undefined) api.reset(widgetId);
  }

  onMount(() => {
    if (!siteKey || !container) return;
    let destroyed = false;
    const el = container;
    loadTurnstile().then(
      (turnstile) => {
        // The script can land after the form is gone (a fast navigation).
        if (destroyed) return;
        api = turnstile;
        widgetId = turnstile.render(el, { sitekey: siteKey, theme: 'auto' });
      },
      () => {
        // Blocked or offline: the submit comes back as "complete the check".
      },
    );
    return () => {
      destroyed = true;
      if (api && widgetId !== undefined) api.remove(widgetId);
      widgetId = undefined;
    };
  });
</script>

{#if siteKey}
  <div bind:this={container} class="mt-3 flex justify-center" data-testid="turnstile-widget"></div>
{/if}
