<script lang="ts">
  // #879 — "download everything checked", once, for the host the user picks.
  //
  // The endpoint answers with JSON — the archive plus what it LEFT OUT — so a
  // skill the server refused to render is named here, with the server's
  // reason, instead of simply being absent from a zip the user then installs.
  // Holger's design (#879): target selection happens at the export action, and
  // the per-host enable flags stay behind one checkbox per row.
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { BUNDLE_HOSTS, type SkillBundleHost, type SkippedSkill } from '$lib/skill-bundle';
  import { hostLabel } from '$lib/skill-export';
  import { exportSaves } from '$lib/skill-export-saves.svelte';

  interface Props {
    orgId: string;
    /** The rows whose checkbox is on, with the hosts each is declared for. */
    checked: Array<{ name: string; urn: string; hosts: string[] }>;
    /**
     * The list stopped at the loader's cap. `checked` then covers only the
     * rows shown, while the download plans the WHOLE org — so the count is a
     * lower bound and must not disable the buttons (@codex on #890).
     */
    truncated?: boolean;
    /** How many rows the list shows — the scope a truncated count covers. */
    shown?: number;
  }

  let { orgId, checked, truncated = false, shown = 0 }: Props = $props();

  const checkedCount = $derived(checked.length);
  const saving = $derived(exportSaves.pending > 0);

  interface Report {
    host: SkillBundleHost;
    filename: string;
    included: Array<{ name: string; urn: string }>;
    skipped: SkippedSkill[];
    /**
     * Checked rows NOT declared for this host (a single-host export). The
     * server scans such a node but does not judge it for this host, so it is in
     * neither `included` nor `skipped` — only the page knows it was checked
     * (@codex on #890).
     */
    notForHost: Array<{ name: string; urn: string; hosts: string[] }>;
  }

  let pendingHost = $state<SkillBundleHost | null>(null);
  let report = $state<Report | null>(null);
  let failure = $state<string | null>(null);

  const LABELS: Record<SkillBundleHost, () => string> = {
    claudeSkill: () => t('tasks.bundle.claude', 'Download Claude plugin'),
    codexSkill: () => t('tasks.bundle.codex', 'Download for Codex'),
  };

  function failureText(code: string | undefined, detail: string | undefined): string {
    if (code === 'no-memories') return t('tasks.bundle.error.no-memories', 'This organization has no memories to export from.');
    return detail ?? t('tasks.bundle.error.failed', 'The download could not be prepared. Try again shortly.');
  }

  function save(filename: string, base64: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoked on the next task: some browsers start the download
    // asynchronously, and revoking synchronously cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
      if (body.zipBase64) save(body.filename, body.zipBase64);
      report = {
        host,
        filename: body.filename,
        included: body.included,
        skipped: body.skipped,
        notForHost: checked.filter((c) => !c.hosts.includes(host)),
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

  {#if report}
    <div role="status" class="mt-3 space-y-2 text-sm">
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
      {#if report.notForHost.length > 0}
        <div>
          <p class="font-medium text-amber-700 dark:text-amber-400">
            {t('tasks.bundle.not-for-host', 'Checked, but not exported for {host} ({count}):', {
              host: hostLabel(report.host),
              count: report.notForHost.length,
            })}
          </p>
          <ul class="mt-1 space-y-1">
            {#each report.notForHost as c (c.urn)}
              <li class="text-xs text-zinc-600 dark:text-zinc-400">
                <span class="font-medium text-zinc-800 dark:text-zinc-200">{c.name}</span>
                <Urn value={c.urn} type="node" size={8} />
                — {t('tasks.bundle.not-for-host-reason', 'Exported for {hosts} only. Uncheck and check it again to export it everywhere.', {
                  hosts: c.hosts.map(hostLabel).join(', '),
                })}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if report.skipped.length > 0}
        <div>
          <p class="font-medium text-amber-700 dark:text-amber-400">
            {t('tasks.bundle.skipped', 'Left out of the download ({count}):', { count: report.skipped.length })}
          </p>
          <ul class="mt-1 space-y-1">
            {#each report.skipped as s (s.urn)}
              <li class="text-xs text-zinc-600 dark:text-zinc-400">
                <span class="font-medium text-zinc-800 dark:text-zinc-200">{s.name}</span>
                <Urn value={s.urn} type="node" size={8} />
                — {s.reasons.join(' ')}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
</section>
