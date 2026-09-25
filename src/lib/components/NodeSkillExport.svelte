<!--
  #911 — "Export as skill" on a task node's page: ONE task, downloaded as ONE
  skill for the host the user picks.

  The page offers this only for a task whose export is switched on, and only
  for those hosts (Holger, #911). The server still has the last word: it may
  withhold the body (a lint error, a collision), and then nothing is saved and
  its reasons are shown. A download that quietly contains nothing is the
  failure #879 was written against.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { isBundleHost, type SkillBundleHost } from '$lib/skill-bundle';
  import { hostLabel } from '$lib/skill-export';
  import { saveBase64Download } from '$lib/save-download';

  interface Props {
    /** POST target: `<node page>/skill`. */
    endpoint: string;
    /** The hosts this task's export is switched on for (`activeExportHosts`). */
    hosts: string[];
  }

  let { endpoint, hosts }: Props = $props();

  const offered = $derived(hosts.filter(isBundleHost));

  type Report =
    | { kind: 'saved'; host: SkillBundleHost; filename: string }
    | { kind: 'refused'; host: SkillBundleHost; reasons: string[] }
    | { kind: 'failed'; message: string };

  let pendingHost = $state<SkillBundleHost | null>(null);
  let report = $state<Report | null>(null);

  async function download(host: SkillBundleHost) {
    pendingHost = host;
    report = null;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        report = {
          kind: 'failed',
          // The endpoint's own words: `detail` for a failed plan or read,
          // `message` for an expired sign-in (401), where "try again" would
          // fail every time (@codex / @copilot on #912).
          message: body?.detail ?? body?.message ?? t('node.skill-export.error', 'The skill could not be prepared. Try again shortly.'),
        };
        return;
      }
      if (body.zipBase64 && body.filename) {
        saveBase64Download(body.filename, body.zipBase64);
        report = { kind: 'saved', host, filename: body.filename };
      } else {
        report = { kind: 'refused', host, reasons: Array.isArray(body.reasons) ? body.reasons : [] };
      }
    } catch {
      report = { kind: 'failed', message: t('node.skill-export.error', 'The skill could not be prepared. Try again shortly.') };
    } finally {
      pendingHost = null;
    }
  }
</script>

<div class="space-y-2" data-testid="node-skill-export">
  <p class="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('node.skill-export.heading', 'Export as skill')}</p>
  <div class="flex flex-col gap-2">
    {#each offered as host (host)}
      <button
        type="button"
        onclick={() => download(host)}
        disabled={pendingHost !== null}
        class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {pendingHost === host
          ? t('node.skill-export.preparing', 'Preparing…')
          : t('node.skill-export.download', 'Download for {host}', { host: hostLabel(host) })}
      </button>
    {/each}
  </div>

  {#if report}
    <div role="status" class="text-sm">
      {#if report.kind === 'saved'}
        <p class="text-zinc-700 dark:text-zinc-300">
          {t('node.skill-export.saved', 'Downloaded {file}.', { file: report.filename })}
          {#if report.host === 'claudeSkill'}
            {t('node.skill-export.install-claude', 'To install it in Claude, upload the file under Customize → Skills. For Claude Code, unzip it into ~/.claude/skills.')}
          {:else}
            {t('node.skill-export.install-codex', 'To install it in Codex, unzip it into ~/.agents/skills — or a project’s .agents/skills folder.')}
          {/if}
        </p>
      {:else if report.kind === 'refused'}
        <p class="text-amber-700 dark:text-amber-400">
          {t('node.skill-export.refused', 'Nothing was downloaded. The {host} export was refused:', { host: hostLabel(report.host) })}
        </p>
        <!-- Not a TanStack grid: this is one task's reasons, a few sentences
             of prose, not rows a reader sorts or searches. -->
        <ul class="list-disc pl-5 text-zinc-700 dark:text-zinc-300">
          {#each report.reasons as reason, i (i)}
            <li>{reason}</li>
          {/each}
        </ul>
      {:else}
        <p class="text-red-600 dark:text-red-400">{report.message}</p>
      {/if}
    </div>
  {/if}
</div>
