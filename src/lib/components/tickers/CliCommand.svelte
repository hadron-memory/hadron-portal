<!--
  portal#1496 (MCP cut P1): one change the portal does not make yet, as a
  sentence and the hadron CLI command to copy, on a line of its own. The
  command breaks anywhere, so a long URN wraps inside its column.
-->
<script lang="ts">
  let { label, command }: { label: string; command: string } = $props();
</script>

<div class="min-w-0">
  <p>{label}</p>
  <code data-testid="cli-command" class="block break-all font-mono text-zinc-700 select-all dark:text-zinc-300">{command}</code>
</div>
