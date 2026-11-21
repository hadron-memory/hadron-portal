<script lang="ts">
  import '../app.css';
  import NavigationFeedback from '$lib/components/NavigationFeedback.svelte';
  import Nav from '$lib/components/Nav.svelte';
  import { onMount } from 'svelte';
  import { readStoredTheme, resolveDark, writeStoredTheme, type ThemePreference } from '$lib/theme';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  // #419: Light, Dark or System. Until the stored choice is read on mount the
  // page is dark, as it always was.
  let theme = $state<ThemePreference>('dark');
  let systemDark = $state(true);
  const dark = $derived(resolveDark(theme, systemDark));

  onMount(() => {
    theme = readStoredTheme(localStorage);
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark = query.matches;
    const follow = (e: MediaQueryListEvent) => (systemDark = e.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark', dark);
  });

  function setTheme(next: ThemePreference) {
    theme = next;
    writeStoredTheme(localStorage, next);
  }
</script>

<NavigationFeedback />

<div class="min-h-screen {dark ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}">
  <Nav user={data.user} {dark} {theme} onSetTheme={setTheme} />
  <main>
    {@render children()}
  </main>
</div>
