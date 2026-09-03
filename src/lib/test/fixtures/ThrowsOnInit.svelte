<script lang="ts">
  // Throws SYNCHRONOUSLY during component init, so `mount()` itself propagates
  // it. Deliberately not an onMount throw: an async onMount rejects rather than
  // throws (see captureUnhandledRejections), so it would not exercise the
  // mount-failure cleanup path at all.
  throw new Error('boom during init');
</script>
<div>never rendered</div>
