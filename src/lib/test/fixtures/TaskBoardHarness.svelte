<script lang="ts">
  import { untrack } from 'svelte';
  import Page from '../../../routes/app/apps/[appId]/tasks/+page.svelte';
  let { initial }: { initial: any } = $props();
  let data = $state(untrack(() => initial));
  export function navigate(next: any) { data = next; }
</script>
<Page {data} />
