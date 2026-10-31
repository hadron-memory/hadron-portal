<script>
 import Urn from './components/Urn.svelte';
 import ThemeMenu from './components/ThemeMenu.svelte';
 let preference=$state('light');
 function select(value){preference=value;document.documentElement.classList.toggle('dark',value==='dark');}
</script>
<main class="min-h-screen bg-white p-12 text-zinc-900 dark:bg-zinc-950 dark:text-white">
 <h1 class="mb-4 text-2xl font-semibold">QA-only action chip harness</h1>
 <p class="mb-8">Exact frozen Urn.svelte imported unchanged. Synthetic fixture; no production route claimed.</p>
 <div class="mb-8 flex justify-end"><ThemeMenu {preference} dark={preference==='dark'} onselect={select}/></div>
 <Urn value="hrn:action:e2e-alpha:qa1520-team:qa.browser.check" linked/>
</main>
