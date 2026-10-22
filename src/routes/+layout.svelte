<script lang="ts">
  import '../app.css';
  import NavigationFeedback from '$lib/components/NavigationFeedback.svelte';
  import Nav from '$lib/components/Nav.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  let dark = $state(true);

  $effect(() => {
    const stored = localStorage.getItem('theme');
    dark = stored !== 'light';
    document.documentElement.classList.toggle('dark', dark);
  });

  function toggleTheme() {
    dark = !dark;
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark);
  }
</script>

<NavigationFeedback />

<div class="min-h-screen {dark ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}">
  <Nav user={data.user} {dark} onToggleTheme={toggleTheme} />
  <main>
    {@render children()}
  </main>
</div>
