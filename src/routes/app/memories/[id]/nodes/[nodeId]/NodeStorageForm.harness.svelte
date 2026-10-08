<!--
  Test-only: mounts NodeStorageForm from the props the retired `/edit` page took
  ({ data, form }), so the mounted tests written against that page (#864,
  #867, #878, #882, #887, #905) drive the same form on its new home (#1031)
  without each re-deriving the mapping. Reassigning `data` stands in for a
  navigation, exactly as it did for the page.
-->
<script lang="ts">
  import NodeStorageForm from './NodeStorageForm.svelte';

  let { data, form = null }: { data: any; form?: unknown } = $props();
</script>

<NodeStorageForm
  node={data.node}
  memorySchema={data.graph.schema}
  seed={data.form}
  actionData={form}
  action="?/updateStorage"
  skillCheck={data.skillCheck ?? null}
  runnableBlockedBy={data.runnableBlockedBy ?? null}
  noWriteDoor={data.noWriteDoor ?? null}
/>
