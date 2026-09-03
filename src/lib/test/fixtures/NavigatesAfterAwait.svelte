<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // #789/#794 exactly: a continuation that rewrites the URL after an await.
  // The real fix put the guard in the CALLEE — the one function performing the
  // dangerous act — because one call site can have two lifetimes.
  let { guard = false, navigate }: { guard?: boolean; navigate: (url: string) => void } = $props();
  let destroyed = false;
  onDestroy(() => { destroyed = true; });

  function syncUrl(url: string) {
    if (guard && destroyed) return;
    navigate(url);
  }

  onMount(async () => {
    await Promise.resolve();
    syncUrl('/app/agents?chat=late');
  });
</script>
<div>nav</div>
