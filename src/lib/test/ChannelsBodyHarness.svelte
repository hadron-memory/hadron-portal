<script lang="ts">
  // Test harness for the Channels section's body: takes the old Channels page's `data` and `form` (the panel's fields,
  // plus an optional `navOrgs`) and supplies the section's own props, so the page's tests keep their data literals.
  // Its actions are the bare `?/<name>` form an App-scoped page would post to.
  import AppChannelsBody from '../../routes/app/apps/[appId]/AppChannelsBody.svelte';

  let { data, form = null }: { data: Record<string, any>; form?: unknown } = $props();
  const panel = $derived({ kind: 'ok' as const, ...data }) as never;
  const orgIds = $derived(((data.navOrgs ?? []) as { id: string }[]).map((o) => o.id));
</script>

<AppChannelsBody data={panel} {form} appId={data.app.id} {orgIds} onwrite={() => {}} actionUrl={(name) => `?/${name}`} />
