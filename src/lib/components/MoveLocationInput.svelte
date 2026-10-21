<script lang="ts">
  import { locOfSameMemoryTarget, sameMemoryTarget } from '$lib/urn/move-destination';

  /**
   * #1164 — the Move dialog's Location field: the loc of the destination in the
   * node's OWN memory. `target` stays the one value the form submits (the hidden
   * input), so Location and the full-URN field cannot disagree. This component
   * never decides which mode the dialog is in: an empty or odd value is still
   * Location, so clearing the field cannot swap it out from under the cursor
   * (#1192 review). The dialog switches to the full URN only on an explicit act.
   */
  let {
    memoryUrn,
    target = $bindable(),
    inputClass,
    invalid = false,
    error,
    describedby,
  }: {
    memoryUrn: string;
    target: string;
    inputClass: string;
    invalid?: boolean;
    error?: string;
    describedby?: string;
  } = $props();

  const errorText = $derived(error || undefined);
  const location = $derived(locOfSameMemoryTarget(memoryUrn, target) ?? '');
</script>

<input type="hidden" name="target" value={target} />
<input
  id="moveTarget"
  type="text"
  value={location}
  oninput={(e) => (target = sameMemoryTarget(memoryUrn, e.currentTarget.value))}
  spellcheck="false"
  aria-invalid={invalid ? 'true' : undefined}
  aria-describedby={describedby}
  class="{inputClass} font-mono text-xs {invalid ? 'border-red-500 focus:border-red-500' : ''}"
/>
{#if errorText}
  <!-- aria-describedby points here: a refused move must say why in Location mode too (#1192 QA). -->
  <p id="moveTargetError" class="mt-1 text-xs text-red-500">{errorText}</p>
{/if}
