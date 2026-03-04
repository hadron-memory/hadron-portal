<script lang="ts">
  import '../app.css';
  import Nav from '$lib/components/Nav.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100">
  <Nav user={data.user} />
  <main>
    {@render children()}
  </main>
</div>
