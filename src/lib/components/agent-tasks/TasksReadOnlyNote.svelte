<!--
  portal#1052 — the one quiet line that says where task writes happen
  (design §8; Holger #10660: read-only first). The views show no disabled
  write buttons; this line is the whole story.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
</script>

<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400" data-testid="tasks-read-only">
  {t('app.tasks.read-only', 'Read-only for now. Create, assign, park and cancel tasks with the CLI or MCP.')}
</p>
