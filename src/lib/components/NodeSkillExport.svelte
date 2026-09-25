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
  import { onDestroy } from 'svelte';
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

  /**
   * The endpoint's refusals, in words. Each one fails the same way on every
   * retry, so "try again" would be wrong for all of them (@codex on #912):
   * the page itself is stale, and reloading it is the remedy.
   */
  function refusalText(code: unknown): string | null {
    if (code === 'wrong-memory')
      return t('node.skill-export.wrong-memory', 'This task is no longer in this memory — it may have been moved. Reload the page and try again.');
    if (code === 'not-found')
      return t('node.skill-export.not-found', 'This task could not be found — it may have been deleted. Reload the page.');
    if (code === 'not-a-task')
      return t('node.skill-export.not-a-task', 'Only a task node can be exported as a skill. Reload the page to see its current state.');
    return null;
  }

  let pendingHost = $state<SkillBundleHost | null>(null);
  let report = $state<Report | null>(null);

  /**
   * The request in flight. The panel is a popover: closing it, or the page
   * moving to another node, unmounts this while a POST may still be pending
   * — and a continuation that ran on would save the OLD node's zip with no
   * panel left to say so (@codex on #912). Teardown aborts it, and every
   * step after an await checks, so nothing is saved or reported after it.
   */
  let inFlight: AbortController | null = null;
  onDestroy(() => inFlight?.abort());

  async function download(host: SkillBundleHost) {
    inFlight?.abort();
    const request = new AbortController();
    inFlight = request;
    pendingHost = host;
    report = null;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
        signal: request.signal,
      });
      const body = await res.json().catch(() => null);
      if (request.signal.aborted) return;
      if (!res.ok || !body) {
        report = {
          kind: 'failed',
          // The endpoint's own words: `detail` for a failed plan or read,
          // `message` for an expired sign-in (401), where "try again" would
          // fail every time (@codex / @copilot on #912).
          message: refusalText(body?.code) ?? body?.detail ?? body?.message ?? t('node.skill-export.error', 'The skill could not be prepared. Try again shortly.'),
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
      if (request.signal.aborted) return;
      report = { kind: 'failed', message: t('node.skill-export.error', 'The skill could not be prepared. Try again shortly.') };
    } finally {
      if (inFlight === request) {
        inFlight = null;
        pendingHost = null;
      }
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
