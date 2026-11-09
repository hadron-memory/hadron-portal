<script lang="ts">
  import { PICK_FIRST, PICK_SECOND } from './ruleEditorPicker';
  // Narrow callback stub: these tests exercise RuleEditor draft/render state,
  // not SelectNode navigation or provider reads (covered by the browser seat).
  let { open = $bindable(false), onselect }: { open?: boolean; onselect: (node: { urn: string }) => void } = $props();
</script>
{#if open}
  <div aria-label="Picker callback fixture">
    <button type="button" onclick={() => onselect({ urn: PICK_FIRST })}>Pick first</button>
    <button type="button" onclick={() => onselect({ urn: PICK_SECOND })}>Pick second</button>
    <button type="button" onclick={() => open = false}>Cancel picker</button>
  </div>
{/if}
