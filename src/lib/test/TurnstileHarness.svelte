<script lang="ts">
  import Turnstile from '$lib/components/Turnstile.svelte';
  let resetKey = $state(0);
</script>
<form>
  <Turnstile {resetKey} />
  <button type="button" onclick={() => resetKey += 1}>Response received</button>
</form>
