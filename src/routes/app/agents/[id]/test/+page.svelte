<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { DriftVerdict, FixtureRunSummary, Verdict } from '$lib/agent-tester/verdict-types';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ProbeForm from '$lib/components/agent-tester/ProbeForm.svelte';
  import RouteTrace from '$lib/components/agent-tester/RouteTrace.svelte';
  import VerdictBadge from '$lib/components/agent-tester/VerdictBadge.svelte';
  import FixtureList from '$lib/components/agent-tester/FixtureList.svelte';
  import DriftReport from '$lib/components/agent-tester/DriftReport.svelte';
  import RunSummary from '$lib/components/agent-tester/RunSummary.svelte';
  import PersonaScript from '$lib/components/agent-tester/PersonaScript.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const agent = $derived(data.agent);
  const org = $derived(data.org);
  const llmReady = $derived(data.llmProviderConfigured);
  // #928: why not, when not — or which config, when ready.
  const llm = $derived(data.llm);
  const fixtures = $derived(data.fixtures ?? []);

  function configLevelLabel(ownerType: string): string {
    switch (ownerType) {
      case 'AGENT':
        return t('agent-tester.llm-provider.level.agent', 'this agent');
      case 'ORGANIZATION':
        return t('agent-tester.llm-provider.level.org', "this agent's organization");
      case 'HADRON_SERVER':
        return t('agent-tester.llm-provider.level.host', 'the platform default');
      default:
        // A level added server-side later reads as itself, not as a wrong guess.
        return ownerType;
    }
  }

  type Assertion =
    | { mode: 'literal-contains'; value: string }
    | { mode: 'regex'; pattern: string; flags: string }
    | { mode: 'llm-judge'; criterion: string; threshold: number };

  type AssertionResult = {
    mode: 'literal-contains' | 'regex' | 'llm-judge';
    // #808: `unevaluated` = the assertion did not run. Not a pass, not a fail.
    verdict: Verdict;
    detail: string;
    judgeScore?: number | null;
    judgeRationale?: string;
  };

  type Result = {
    reply: string;
    routeTrace: {
      conversationLoc: string | null;
      stageLoc: string | null;
      personaName: string | null;
      routeCandidates?: Array<{ conversationLoc: string; rejected: boolean; reason?: string }>;
      onTrack?: boolean;
      offTrackReason?: string | null;
    };
    assertion: AssertionResult | null;
  } | null;

  type DriftResult = {
    fixtureLoc: string;
    newReply: string;
    newRoute: { conversationLoc: string | null; stageLoc: string | null; personaName: string | null };
    newVerdict: Verdict;
    newDetail: string;
    drift: {
      reply: 'same' | 'different';
      route: 'same' | 'different';
      verdict: DriftVerdict;
    };
    baselineRefused?: string;
  };

  // Single-probe result + the assertion used (kept for "Save as fixture").
  let result = $state<Result>(null);
  let lastPayload = $state<{
    message: string;
    persona: string | null;
    assertion: Assertion | null;
  } | null>(null);

  // Drift report from running fixtures.
  let driftResults = $state<DriftResult[] | null>(null);
  // #813: the endpoint has always returned this and nothing read it.
  let runSummary = $state<FixtureRunSummary | null>(null);

  let running = $state(false);
  let errorText = $state<string | null>(null);
  let saveLabel = $state('');

  // Per Portal Invariant P4 — markdown → HTML → DOMPurify before insertion.
  const replyHtml = $derived.by(() => {
    if (!result?.reply) return '';
    const raw = String(marked.parse(result.reply));
    return DOMPurify.sanitize(raw);
  });

  async function run(payload: {
    message: string;
    persona: string | null;
    resetSession: boolean;
    assertion: Assertion | null;
  }) {
    running = true;
    errorText = null;
    if (payload.resetSession) result = null;
    lastPayload = { message: payload.message, persona: payload.persona, assertion: payload.assertion };
    try {
      const res = await fetch('/api/agent-chat/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          message: payload.message,
          persona: payload.persona,
          resetSession: payload.resetSession,
          assertion: payload.assertion,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        errorText = body.error ?? 'Request failed';
        return;
      }
      result = (await res.json()) as Result;
      driftResults = null;
      runSummary = null;
    } catch (e) {
      errorText = e instanceof Error ? e.message : 'Request failed';
    } finally {
      running = false;
    }
  }

  // #808: saving captures this probe's result as the fixture's BASELINE. An
  // assertion that did not run produced no result, so there is nothing to
  // baseline — saving anyway would freeze a transient worker or judge failure
  // into the fixture as its expected behaviour, and every later replay would
  // compare against it. The endpoint refuses this too; this is the reason the
  // user gets to see, next to the control.
  //
  // An ALLOWLIST, not `!== 'unevaluated'`. A denylist makes every verdict added
  // later savable by default, and the default for a write guard should be to
  // refuse. The endpoint's gate is an allowlist for the same reason.
  const canSaveFixture = $derived(
    result?.assertion == null
      || result.assertion.verdict === 'pass'
      || result.assertion.verdict === 'fail',
  );

  async function saveAsFixture() {
    if (!result || !lastPayload || !saveLabel.trim() || !canSaveFixture) return;
    running = true;
    errorText = null;
    try {
      const res = await fetch('/api/agent-chat/fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          label: saveLabel.trim(),
          turn: {
            user: lastPayload.message,
            persona: lastPayload.persona,
            assertion: lastPayload.assertion,
          },
          captured: result.assertion
            ? { reply: result.reply, route: result.routeTrace, verdict: result.assertion.verdict }
            : { reply: result.reply, route: result.routeTrace, verdict: 'pass' },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Save failed' }));
        errorText = body.error ?? 'Save failed';
        return;
      }
      saveLabel = '';
      await invalidateAll();
    } catch (e) {
      errorText = e instanceof Error ? e.message : 'Save failed';
    } finally {
      running = false;
    }
  }

  async function runOneFixture(loc: string, ackCap = false) {
    running = true;
    errorText = null;
    try {
      const res = await fetch('/api/agent-chat/fixtures/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, fixtureLoc: loc, costCapAcknowledged: ackCap }),
      });
      await handleRunResponse(res, () => runOneFixture(loc, true));
    } finally {
      running = false;
    }
  }

  async function runAllFixtures(ackCap = false) {
    if (fixtures.length === 0) return;
    running = true;
    errorText = null;
    try {
      const res = await fetch('/api/agent-chat/fixtures/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, costCapAcknowledged: ackCap }),
      });
      await handleRunResponse(res, () => runAllFixtures(true));
    } finally {
      running = false;
    }
  }

  // T033: cost-cap dialog flow.
  async function handleRunResponse(res: Response, retryWithAck: () => Promise<void>) {
    if (res.status === 409) {
      const body = await res.json();
      if (body.error === 'cost-cap-exceeded') {
        const msg = `Estimated cost ${body.estimatedCost.currency} ${body.estimatedCost.amount.toFixed(2)} exceeds the ${body.cap.currency} ${body.cap.amount.toFixed(2)} cap. Continue?`;
        if (window.confirm(msg)) {
          await retryWithAck();
        }
        return;
      }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Run failed' }));
      errorText = body.error ?? 'Run failed';
      return;
    }
    const body = await res.json();
    driftResults = body.results;
    runSummary = body.summary ?? null;
    result = null; // hide the single-probe panel while showing drift
  }

  async function deleteFixture(loc: string) {
    if (!window.confirm(t('agent-tester.fixtures.delete-confirm', 'Delete this fixture? This cannot be undone.'))) return;
    running = true;
    errorText = null;
    try {
      const res = await fetch(`/api/agent-chat/fixtures?agentId=${encodeURIComponent(agent.id)}&fixtureLoc=${encodeURIComponent(loc)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ error: 'Delete failed' }));
        errorText = body.error ?? 'Delete failed';
        return;
      }
      await invalidateAll();
    } finally {
      running = false;
    }
  }

  async function acceptBaseline(loc: string) {
    running = true;
    errorText = null;
    try {
      const res = await fetch('/api/agent-chat/fixtures/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, fixtureLoc: loc, acceptNewBaseline: true }),
      });
      await handleRunResponse(res, () => acceptBaseline(loc));
      await invalidateAll();
    } finally {
      running = false;
    }
  }
</script>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('agent-tester.breadcrumb.dashboard', 'Dashboard'), href: '/app/dashboard' },
    { label: t('agent-tester.breadcrumb.agents', 'Agents'), href: org ? `/app/orgs/${org.id}/agents` : '/app/agents' },
    { label: agent.name, href: `/app/agents/${agent.id}` },
    { label: t('agent-tester.breadcrumb.test', 'Test') },
  ]} />

  <header class="space-y-1">
    <h1 class="text-xl font-semibold text-zinc-900 dark:text-white">
      {t('agent-tester.heading', 'Test chatbot')}: {agent.name}
    </h1>
    <p class="text-sm text-zinc-500 dark:text-zinc-400">
      {t('agent-tester.subhead', 'Send a single message to probe routing and stage transitions.')}
    </p>
  </header>

  <!-- v1 honesty notice: the Tester drives the real chat platform.
       Full production-state isolation is the topic of the
       tester-vs-production-memory-boundary design discussion. -->
  <section class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
    <p>
      <strong class="font-semibold">{t('agent-tester.notice.heading', 'Test runs are real chats')}:</strong>
      {t(
        'agent-tester.notice.body',
        'each run creates a chat in your history under this agent and may write extracted facts back into your personal memory. The platform license-grant (AgentSubscription) is the one side-effect that is suppressed. Cleaner test-only isolation is planned.',
      )}
    </p>
  </section>

  {#if !llmReady}
    <section class="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {#if llm?.status === 'unavailable'}
        <!-- #928: a refusal other than "nothing configured" — the runtime makes
             this same call before every turn, so the Tester cannot run either.
             The server's words, not a guess at the cause. -->
        <h2 class="mb-1 font-semibold">{t('agent-tester.llm-provider.unavailable-heading', "The Tester can't use this agent's LLM configuration")}</h2>
        <p>{llm.detail ?? t('agent-tester.llm-provider.unavailable-body', 'The configuration could not be resolved. Reload to try again.')}</p>
      {:else}
        <h2 class="mb-1 font-semibold">{t('agent-tester.llm-provider.heading', 'LLM provider not configured')}</h2>
        <p>
          {t('agent-tester.llm-provider.body', 'Configure an LLM provider for this agent before running the Tester.')}
          <a href={`/app/agents/${agent.id}`} class="font-medium text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400">
            {t('agent-tester.llm-provider.link', 'Open agent settings →')}
          </a>
        </p>
        {#if llm?.status === 'not-configured' && llm.detail}
          <p class="mt-1 text-xs">{llm.detail}</p>
        {/if}
      {/if}
    </section>
  {:else}
    <section class="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {#if llm?.status === 'ready'}
        <!-- #928: say WHERE the config came from — an inherited one is the case
             the old readiness check refused. -->
        <p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          {t('agent-tester.llm-provider.using', 'Using the "{name}" config from {level}: {provider} · {model}', {
            name: llm.name,
            level: configLevelLabel(llm.ownerType),
            provider: llm.provider,
            model: llm.model,
          })}
        </p>
      {/if}
      <ProbeForm onrun={run} {running} />
    </section>

    {#if errorText}
      <section class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {errorText}
      </section>
    {/if}

    {#if result}
      <section class="space-y-3">
        <div class="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('agent-tester.reply.heading', 'Reply')}
          </h3>
          <div class="prose prose-sm max-w-none dark:prose-invert">
            {@html replyHtml}
          </div>
        </div>
        {#if result.assertion}
          <VerdictBadge assertion={result.assertion} />
        {/if}
        <RouteTrace trace={result.routeTrace} />

        <div class="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex items-center gap-2">
            <input
              type="text"
              bind:value={saveLabel}
              placeholder={t('agent-tester.save.placeholder', 'Fixture label (e.g. welcome-greeting)')}
              maxlength="80"
              class="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              disabled={running || !canSaveFixture}
            />
            <button
              type="button"
              onclick={saveAsFixture}
              disabled={!saveLabel.trim() || running || !canSaveFixture}
              class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              {t('agent-tester.save.button', 'Save as fixture')}
            </button>
          </div>
          {#if !canSaveFixture}
            <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t(
                'agent-tester.save.unevaluated',
                'The assertion did not run, so this probe has no result to save as a baseline. Run it again.',
              )}
            </p>
          {/if}
        </div>
      </section>
    {/if}

    {#if data.fixturesError}
      <p role="alert" class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t('agent-tester.fixtures.load-failed', 'Could not load this agent’s fixtures, so the list below may be incomplete. Reload to try again.')}
      </p>
    {/if}
    <FixtureList
      {fixtures}
      {running}
      onrunone={(loc) => runOneFixture(loc)}
      onrunall={() => runAllFixtures()}
      ondelete={deleteFixture}
    />

    {#if runSummary}
      <RunSummary summary={runSummary} />
    {/if}

    {#if driftResults}
      <DriftReport results={driftResults} onacceptbaseline={acceptBaseline} />
    {/if}

    <PersonaScript agentId={agent.id} />
  {/if}

  {#if org}
    <footer class="text-xs text-zinc-400 dark:text-zinc-500">
      {t('agent-tester.footer.org', 'Org')}: {org.name}
    </footer>
  {/if}
</div>
