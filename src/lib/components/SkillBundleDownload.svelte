<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // #879 — "download everything checked", once, for the host the user picks.
  //
  // The endpoint answers with JSON — the archive plus what it LEFT OUT — so a
  // skill the server refused to render is named here, with the server's
  // reason, instead of simply being absent from a zip the user then installs.
  // Holger's design (#879): target selection happens at the export action, and
  // the per-host enable flags stay behind one checkbox per row.
  import SkillExportLeftOutTable, { type LeftOutRow } from '$lib/components/SkillExportLeftOutTable.svelte';
  import { t } from '$lib/i18n/t';
  import { BUNDLE_HOSTS, type SkillBundleHost, type SkippedSkill, type UnrecognizedNode } from '$lib/skill-bundle';
  import { exportKeyList, hostLabel } from '$lib/skill-export';
  import { exportSaves } from '$lib/skill-export-saves.svelte';
  import { saveBase64Download } from '$lib/save-download';

  interface Props {
    orgId: string;
    /** Rows whose checkbox is on — shown so the user knows what "all" means. */
    checkedCount: number;
    /**
     * The list stopped at the loader's cap. `checkedCount` then covers only the
     * rows shown, while the download plans the WHOLE org — so the count is a
     * lower bound and must not disable the buttons (@codex on #890).
     */
    truncated?: boolean;
    /** How many rows the list shows — the scope a truncated count covers. */
    shown?: number;
  }

  let { orgId, checkedCount, truncated = false, shown = 0 }: Props = $props();

  const saving = $derived(exportSaves.pending > 0);

  interface Report {
    host: SkillBundleHost;
    filename: string;
    /** #909: the Claude plugin's content-derived version; null for Codex. */
    version: string | null;
    included: Array<{ name: string; urn: string }>;
    /** Every checked task left out, whichever the cause — one grid. */
    leftOut: LeftOutRow[];
    /** The other-host check failed; the report says so rather than claim completeness. */
    notForHostUnknown: string | null;
    /** The org's system memories could not be listed: their skills may be missing. */
    scopeIncomplete: boolean;
    /** server#1296: tasks with export keys no host reads — in the download or not. */
    unrecognized: LeftOutRow[];
  }

  /**
   * One row per left-out task. Two causes, both from the SERVER, uncapped:
   * the plan withheld the skill (its reasons), or the task is declared for the
   * other host only — which the chosen host's plan scans and never lists
   * (@codex on #890).
   */
  function leftOutRows(
    skipped: SkippedSkill[],
    notForHost: Array<{ name: string; urn: string }>,
    otherHost: string,
  ): LeftOutRow[] {
    return [
      ...skipped.map((s) => ({ name: s.name, urn: s.urn, reason: s.reasons.join(' ') })),
      ...notForHost.map((n) => ({
        name: n.name,
        urn: n.urn,
        reason: t(
          'tasks.bundle.not-for-host-reason',
          'Exported for {host} only. Uncheck and check it again to export it everywhere.',
          { host: hostLabel(otherHost) },
        ),
      })),
    ];
  }

  /**
   * server#1296 — one row per task whose export setting carries a key no host
   * reads. Its own grid, not "Left out": most such tasks ARE in the download
   * through a key a host does read, and only the rest are missing because of
   * it. The portal says which, and counts the keys with the server's TRUE
   * total (`keyCount`); the server's own warnings follow verbatim.
   */
  // t() has no plural rules, so singular and plural are separate strings
  // (@copilot on #902: "key(s) on it" read as broken English).
  function unrecognizedSummary(n: UnrecognizedNode): string {
    const one = n.keyCount === 1;
    if (n.inDownload) {
      return one
        ? t('tasks.bundle.unrecognized.in-download.one', 'In this download. It also has an export key that no host reads, which is ignored.')
        : t('tasks.bundle.unrecognized.in-download.many', 'In this download. It also has {count} export keys that no host reads, which are ignored.', { count: n.keyCount });
    }
    return one
      ? t('tasks.bundle.unrecognized.not-in-download.one', 'Not in this download. It has an export key that no host reads.')
      : t('tasks.bundle.unrecognized.not-in-download.many', 'Not in this download. It has {count} export keys that no host reads.', { count: n.keyCount });
  }

  function unrecognizedRows(nodes: UnrecognizedNode[]): LeftOutRow[] {
    return nodes.map((n) => ({
      name: n.name,
      urn: n.urn,
      reason: [
        unrecognizedSummary(n),
        ...n.messages,
      ].join(' '),
    }));
  }

  let pendingHost = $state<SkillBundleHost | null>(null);
  let report = $state<Report | null>(null);
  let failure = $state<string | null>(null);

  const LABELS: Record<SkillBundleHost, () => string> = {
    claudeSkill: () => t('tasks.bundle.claude', 'Download Claude plugin'),
    codexSkill: () => t('tasks.bundle.codex', 'Download for Codex'),
  };

  function failureText(code: string | undefined, detail: string | undefined): string {
    if (code === 'scope-forbidden') {
      return t('tasks.bundle.error.scope-forbidden', 'Downloading tasks requires Contributor access or higher in this organization.');
    }
    if (code === 'no-memories') return t('tasks.bundle.error.no-memories', 'This organization has no memories to export from.');
    return detail ?? t('tasks.bundle.error.failed', 'The download could not be prepared. Try again shortly.');
  }

  async function download(host: SkillBundleHost) {
    pendingHost = host;
    failure = null;
    report = null;
    try {
      const res = await fetch(`/app/orgs/${orgId}/tasks/plugin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        failure = failureText(body?.code, body?.detail ?? body?.message);
        return;
      }
      if (body.zipBase64) saveBase64Download(body.filename, body.zipBase64);
      report = {
        host,
        filename: body.filename,
        version: body.version ?? null,
        included: body.included,
        leftOut: leftOutRows(body.skipped ?? [], body.notForHost ?? [], body.otherHost ?? ''),
        notForHostUnknown: body.notForHostUnknown ?? null,
        scopeIncomplete: body.scopeIncomplete === true,
        unrecognized: unrecognizedRows(body.unrecognized ?? []),
      };
    } catch {
      failure = failureText(undefined, undefined);
    } finally {
      pendingHost = null;
    }
  }
</script>

<section
  aria-labelledby="skill-bundle-heading"
  class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0">
      <h2 id="skill-bundle-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">
        {t('tasks.bundle.heading', 'Export as skills')}
      </h2>
      <p class="text-xs text-zinc-500">
        {#if truncated}
          {t(
            'tasks.bundle.summary-truncated',
            'Check a task to include it. Checked among the {shown} tasks shown: {count}. The download includes every checked task in the organization.',
            { shown, count: checkedCount },
          )}
        {:else}
          {t('tasks.bundle.summary', 'Check a task to include it. Checked in this organization: {count}.', {
            count: checkedCount,
          })}
        {/if}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each BUNDLE_HOSTS as host (host)}
        <button
          type="button"
          class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
          disabled={pendingHost !== null || saving || (checkedCount === 0 && !truncated)}
          aria-describedby={saving ? 'skill-bundle-saving' : checkedCount === 0 && !truncated ? 'skill-bundle-none' : undefined}
          onclick={() => download(host)}
        >{pendingHost === host ? t('tasks.bundle.preparing', 'Preparing…') : LABELS[host]()}</button>
      {/each}
    </div>
  </div>
  {#if saving}
    <p id="skill-bundle-saving" class="mt-2 text-xs text-zinc-500">
      {t('tasks.bundle.saving', 'Saving a change — the download waits for it, so it includes what you just checked.')}
    </p>
  {:else if checkedCount === 0 && !truncated}
    <p id="skill-bundle-none" class="mt-2 text-xs text-zinc-500">
      {t('tasks.bundle.none', 'Nothing is checked yet, so there is nothing to download.')}
    </p>
  {/if}

  {#if failure}
    <p role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{failure}</p>
  {/if}

  <LiveRegion>
    {#if report}
      <div class="mt-3 space-y-2 text-sm">
        {#if report.included.length === 0}
          <p class="text-amber-700 dark:text-amber-400">
            {t('tasks.bundle.empty', 'No skill could be exported, so nothing was downloaded.')}
          </p>
        {:else}
          <p class="text-zinc-700 dark:text-zinc-300">
            {t('tasks.bundle.done', 'Prepared {file} for download. Skills in it: {count}.', {
              file: report.filename,
              count: report.included.length,
            })}
            {#if report.host === 'claudeSkill'}
              {t('tasks.bundle.install-claude', 'To install it in Claude, open Customize → Plugins and upload the file.')}
            {:else}
              {t('tasks.bundle.install-codex', 'To install it in Codex, unzip it into ~/.agents/skills — or a project’s .agents/skills folder.')}
            {/if}
          </p>
        {/if}
        {#if report.scopeIncomplete}
          <p data-testid="bundle-scope-incomplete" class="text-xs text-amber-700 dark:text-amber-400">
            {t(
              'tasks.bundle.scope-incomplete',
              'The organization’s system memories could not be listed, so skills from them may be missing from this download and from this report. Try again shortly.',
            )}
          </p>
        {/if}
      </div>
    {/if}
  </LiveRegion>

  {#if report}
    <div class="mt-2 space-y-2 text-sm">
      {#if report.version}
        <p class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="skill-bundle-version">
          {t('tasks.bundle.version', 'Plugin version {version}. A later download gets a new version only if the plugin’s contents changed.', {
            version: report.version,
          })}
        </p>
      {/if}
      {#if report.notForHostUnknown}
        <p class="text-xs text-amber-700 dark:text-amber-400">
          {t(
            'tasks.bundle.other-host-unknown',
            'Tasks exported only for another host could not be checked, so some may be missing from this list: {detail}',
            { detail: report.notForHostUnknown },
          )}
        </p>
      {/if}
      {#if report.leftOut.length > 0}
        <p class="font-medium text-amber-700 dark:text-amber-400">
          {t('tasks.bundle.skipped', 'Left out of the download ({count}):', { count: report.leftOut.length })}
        </p>
        <SkillExportLeftOutTable rows={report.leftOut} />
      {/if}
      {#if report.unrecognized.length > 0}
        <p class="font-medium text-amber-700 dark:text-amber-400">
          {t('tasks.bundle.unrecognized.heading', 'Export keys no host reads ({count}):', { count: report.unrecognized.length })}
        </p>
        <p class="text-xs text-zinc-500">
          {t(
            'tasks.bundle.unrecognized.help',
            'Only {keys} are export keys. Any other key under exports is ignored, never read as one of them: rename it or remove it in the task’s Properties.',
            { keys: exportKeyList() },
          )}
        </p>
        <SkillExportLeftOutTable
          rows={report.unrecognized}
          listKey="orgs:tasks:export-unrecognized"
          reasonHeader={t('tasks.bundle.unrecognized.column', 'What happened')}
          searchPlaceholder={t('tasks.bundle.unrecognized.search', 'Search tasks with unused export keys…')}
          searchAriaLabel={t('tasks.bundle.unrecognized.search.aria', 'Search the tasks whose export keys no host reads')}
        />
      {/if}
    </div>
  {/if}
</section>
