<script lang="ts">
  import Page from "./+page.svelte";
  import type { PageData, ActionData } from "./$types";
  let { data, form = null }: { data: PageData; form?: ActionData } = $props();
  export function setData(next: PageData) {
    data = next;
  }
  export function setForm(next: ActionData) {
    form = next;
  }
</script>

<Page {data} {form} />
