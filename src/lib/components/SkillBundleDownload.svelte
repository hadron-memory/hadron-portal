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

  interface Props {
    orgId: string;
    /** Rows whose checkbox is on — shown so the user knows what "all" means. */
    checkedCount: number;
  }

  let { orgId, checkedCount }: Props = $props();

  interface Report {
    host: SkillBundleHost;
    filename: string;
    included: Array<{ name: string; urn: string }>;
    skipped: SkippedSkill[];
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
      report = { host, filename: body.filename, included: body.included, skipped: body.skipped };
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
        {t('tasks.bundle.summary', 'Check a task to include it. Checked in this organization: {count}.', {
          count: checkedCount,
        })}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each BUNDLE_HOSTS as host (host)}
        <button
          type="button"
          class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
          disabled={pendingHost !== null || checkedCount === 0}
          aria-describedby={checkedCount === 0 ? 'skill-bundle-none' : undefined}
          onclick={() => download(host)}
        >{pendingHost === host ? t('tasks.bundle.preparing', 'Preparing…') : LABELS[host]()}</button>
      {/each}
    </div>
  </div>
  {#if checkedCount === 0}
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
