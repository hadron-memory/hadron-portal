<script lang="ts">
  import { goodbyeStrings } from '$lib/i18n/delete-account-strings';
</script>

<!-- Post-account-deletion landing page (#662). Public: by the time the user
     arrives here their account and session cookie are gone. -->
<svelte:head><title>{goodbyeStrings.pageTitle()}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-16 text-center">
  <h1 class="mb-6 text-3xl font-bold text-zinc-900 dark:text-white">{goodbyeStrings.heading()}</h1>

  <div class="space-y-6 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
    <p>{goodbyeStrings.body()}</p>
    <p>
      <a href="/" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">{goodbyeStrings.homeLink()}</a>
    </p>
  </div>
</div>
