<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { enhance } from "$app/forms";
  import LiveRegion from "$lib/components/LiveRegion.svelte";
  import { beforeNavigate } from "$app/navigation";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { page } from "$app/state";
  import Breadcrumb from "$lib/components/Breadcrumb.svelte";
  import Urn from "$lib/components/Urn.svelte";
  import DataTable from "$lib/components/table/DataTable.svelte";
  import SelectNode from "$lib/components/SelectNode.svelte";
  import { makeGlobalFilterFn } from "$lib/table/global-filter";
  import { createSvelteTable } from "$lib/table/createSvelteTable.svelte";
  import type { PortalColumnDef } from "$lib/table/features";
  import {
    grantError,
    grantNodeRef,
    grantHolderKey,
    GRANT_REASON_MAX,
    grantReasonLimitMessage,
    type Grant,
    type GrantListPayload,
    type Holder,
  } from "$lib/grants/types";
  import { grantableAction } from "$lib/grants/actions";
  import type { NodeChoice } from "$lib/node-choices";
  import { t } from "$lib/i18n/t";
  import { readGrantList } from "./grant-list";
  import {
    grantMatches,
    grantActorRefs,
    type GrantPageFilter,
  } from "$lib/grants/approval";
  import GrantApproval from "./GrantApproval.svelte";
  import GrantRecord from "./GrantRecord.svelte";
  import type { PageData, ActionData } from "./$types";
  let { data, form }: { data: PageData; form?: ActionData } = $props();
  let alive = true;
  let ownershipEpoch = $state(0),
    submits = 0,
    reads = 0;
  let creating = $state(false),
    reading = $state(false),
    refreshFailed = $state(false),
    rowWrites = $state(0);
  let readAbort: AbortController | null = null;
  const rowTokens = new Set<object>();
  let reread = $state.raw<{
    against: PageData["grants"];
    scope: string;
    value: GrantListPayload;
  } | null>(null);
  const formScope = $derived(JSON.stringify([data.app.id, data.viewerId]));
  const readScope = $derived(
    JSON.stringify([data.routeRef, data.app.id, data.viewerId, data.offset]),
  );
  const view = $derived(
    reread && reread.against === data.grants && reread.scope === readScope
      ? reread.value
      : null,
  );
  const grants = $derived(view?.grants ?? data.grants);
  const holders = $derived(view?.holders ?? data.holders);
  const nodes = $derived(view?.nodes ?? data.nodes);
  const actors = $derived(view?.actors ?? data.actors ?? {});
  let pageFilter = $state<GrantPageFilter>("all");
  let now = $state(Date.now());
  let awaitingCeremony = $state<{ id: string; scope: string } | null>(null);
  let refreshPurpose = $state<"create" | "approval">("create");
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  function startCeremony(id: string) {
    awaitingCeremony = { id, scope: readScope };
  }
  function refreshAfterCeremony() {
    if (
      awaitingCeremony &&
      awaitingCeremony.scope === readScope &&
      current &&
      !reading &&
      !creating &&
      !rowWrites
    )
      void refreshGrants("approval");
  }

  function cancelRefresh() {
    reads++;
    readAbort?.abort();
    readAbort = null;
    reading = false;
  }
  beforeNavigate(() => {
    ownershipEpoch++;
    awaitingCeremony = null;
    cancelRefresh();
  });
  onDestroy(() => {
    alive = false;
    cancelRefresh();
    rowTokens.clear();
  });
  function beginRowWrite() {
    cancelRefresh();
    const token = {};
    rowTokens.add(token);
    rowWrites = rowTokens.size;
    return () => {
      if (rowTokens.delete(token)) rowWrites = rowTokens.size;
    };
  }
  async function refreshGrants(purpose: "create" | "approval" = "create") {
    refreshPurpose = purpose;
    cancelRefresh();
    if (!data.viewerId) {
      refreshFailed = true;
      return;
    }
    const scope = readScope,
      against = data.grants,
      epoch = ownershipEpoch,
      mine = reads;
    const controller = new AbortController();
    readAbort = controller;
    reading = true;
    refreshFailed = false;
    const fresh = await readGrantList(
      {
        appId: data.app.id,
        routeRef: data.routeRef,
        viewerId: data.viewerId,
        offset: data.offset,
      },
      controller.signal,
    );
    if (
      !alive ||
      mine !== reads ||
      epoch !== ownershipEpoch ||
      scope !== readScope ||
      against !== data.grants
    )
      return;
    reading = false;
    readAbort = null;
    if (fresh) {
      reread = { against, scope, value: fresh };
      if (awaitingCeremony) {
        const g = fresh.grants.items.find((g) => g.id === awaitingCeremony!.id);
        if (g && (g.activatedAt || g.revokedAt || g.holderDepartedAt))
          awaitingCeremony = null;
      }
    } else refreshFailed = true;
  }
  let localFailure = $state<string | null>(null);
  // The picked holder and node are authoritative for the grant just created.
  // The page's holder/node projection only covers the current page, so a grant
  // created off page one, or while a refresh is pending or has failed, would
  // otherwise render "Holder unavailable" for a holder the viewer just chose.
  let pendingIdentity: {
    holder: Holder | undefined;
    nodes: Record<string, NodeChoice>;
  } | null = null;
  let createdIdentity = $state.raw<{
    grantId: string;
    holder: Holder | undefined;
    nodes: Record<string, NodeChoice>;
  } | null>(null);
  const submitCreate: SubmitFunction = ({ cancel }) => {
    if (creating || reading || rowWrites) {
      cancel();
      return;
    }
    cancelRefresh();
    const appId = data.routeRef,
      epoch = ownershipEpoch,
      mine = ++submits;
    const owns = () =>
      alive &&
      mine === submits &&
      epoch === ownershipEpoch &&
      page.params.appId === appId;
    creating = true;
    refreshFailed = false;
    localFailure = null;
    pendingIdentity = { holder: pickedHolder, nodes: { ...parameterNodes } };
    return async ({ result, update }) => {
      try {
        if (!owns()) return;
        if (!["success", "failure", "redirect"].includes(result.type)) {
          localFailure = grantError(null);
          return;
        }
        await update({
          reset: result.type === "success",
          invalidateAll: false,
        });
        if (!owns()) return;
        if (result.type === "success") {
          const sent = pendingIdentity;
          const made =
            result.type === "success" &&
            result.data &&
            typeof result.data === "object" &&
            "grant" in result.data
              ? (result.data.grant as Grant)
              : null;
          createdIdentity =
            sent && made ? { grantId: made.id, ...sent } : null;
          parameterNodes = {};
          holderChoice = "";
          reason = "";
          // The action is acknowledged before its bounded section read starts.
          creating = false;
          await refreshGrants();
        }
      } finally {
        if (mine === submits) creating = false;
      }
    };
  };
  let reason = $state("");
  const reasonLength = $derived([...reason.trim()].length);
  let holderChoice = $state("");
  const pickedHolder = $derived(
    holderChoice.startsWith("WORKER:")
      ? data.choices.workers.find((w) => `WORKER:${w.id}` === holderChoice)
      : data.choices.agents.find((a) => `AGENT:${a.id}` === holderChoice),
  );
  const actionDefinitions = $derived(view?.actionDefinitions ?? data.actionDefinitions);
  const actionDefinitionsFailed = $derived(view?.actionDefinitionsFailed ?? data.actionDefinitionsFailed);
  let actionName = $state("");
  const chosenAction = $derived(actionDefinitions.find((a) => a.name === actionName) ?? actionDefinitions.find(grantableAction));
  let parameterNodes = $state<Record<string, NodeChoice>>({});
  let picker = $state(false), pickerParameter = $state(""), pickerAction = $state("");
  $effect.pre(() => {
    formScope;
    untrack(() => {
      ownershipEpoch++;
      submits++;
      parameterNodes = {};
      actionName = "";
      holderChoice = "";
      reason = "";
      picker = false;
      awaitingCeremony = null;
      pageFilter = "all";
      creating = false;
      refreshFailed = false;
      localFailure = null;
    });
  });
  $effect.pre(() => {
    readScope;
    untrack(() => {
      cancelRefresh();
      reread = null;
      refreshFailed = false;
    });
  });
  let rowUpdates = $state<
    Record<string, { grant: Grant; alreadyRevoked: boolean }>
  >({});
  $effect.pre(() => {
    grants;
    untrack(() => {
      cancelRefresh();
      rowUpdates = {};
      rowTokens.clear();
      rowWrites = 0;
    });
  });
  const current = $derived(page.params.appId === data.routeRef);
  const rows = $derived(
    current
      ? grants.items.filter((g) => grantMatches(g, pageFilter, data.viewerId))
      : [],
  );
  let globalFilter = $state("");
  const columns: PortalColumnDef<Grant>[] = [
    {
      id: "grant",
      header: t("grants.column", "Grant"),
      accessorFn: (g) =>
        `${holders[grantHolderKey(g)]?.name ?? ""} ${g.action} ${g.reason} ${g.id} ${g.createdAt} ${nodes?.[grantNodeRef(g, actionDefinitions) ?? ""]?.name ?? ""} ${nodes?.[grantNodeRef(g, actionDefinitions) ?? ""]?.urn ?? ""} ${JSON.stringify(g.values)} ${grantActorRefs(
          g,
        )
          .map(
            (a) =>
              `${a.labels.join(" ")} ${a.id} ${actors[a.kind + ":" + a.id]?.name ?? ""} ${actors[a.kind + ":" + a.id]?.urn ?? ""}`,
          )
          .join(" ")}`,
      enableHiding: false,
      enableSorting: false,
      size: 600,
      minSize: 180,
    },
  ];
  const table = createSvelteTable<Grant>({
    get data() {
      return rows;
    },
    columns,
    manualPagination: true,
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === "function" ? u(globalFilter) : u;
    },
    globalFilterFn: makeGlobalFilterFn<Grant>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  const created = $derived(
    form &&
      "grant" in form &&
      form.appId === data.app.id &&
      form.operation === "create"
      ? form.grant
      : null,
  );
  // Keep the acknowledgement, but prefer the same current-page server row
  // after a ceremony read. An off-page receipt remains its original snapshot.
  const returned = $derived(
    created ? (grants.items.find((g) => g.id === created.id) ?? created) : null,
  );
  // Required choices that keep Create disabled; the browser still enforces the
  // holder and reason on submit, so only the node picks are named here.
  const missingChoices = $derived(
    chosenAction && grantableAction(chosenAction)
      ? chosenAction.parameters
          .filter((p) => !Object.hasOwn(parameterNodes, p.name))
          .map((p) => p.name)
      : [],
  );
  const returnedHolder = $derived.by(() => {
    if (!returned) return undefined;
    const picked =
      createdIdentity?.grantId === returned.id ? createdIdentity.holder : undefined;
    const kind = returned.holderKind;
    return picked && (kind === "WORKER" || kind === "AGENT") && picked.id === returned.holderId
      ? picked
      : holders[grantHolderKey(returned)];
  });
  const returnedNode = $derived.by(() => {
    if (!returned) return undefined;
    const ref = grantNodeRef(returned, actionDefinitions);
    if (ref === null) return undefined;
    const picked =
      createdIdentity?.grantId === returned.id
        ? Object.values(createdIdentity.nodes).find((n) => n.id === ref)
        : undefined;
    return picked ?? nodes?.[ref];
  });
  const feedback = $derived(form && "error" in form ? form.error : null);
  const field =
    "w-full min-h-11 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";
  function href(offset: number) {
    return `?offset=${offset}`;
  }
</script>

<svelte:window onfocus={refreshAfterCeremony} />
<svelte:document
  onvisibilitychange={() => {
    if (document.visibilityState === "visible") refreshAfterCeremony();
  }}
/>

<svelte:head
  ><title>{t("grants.head", "Grants")} · {data.app.name} · Hadron</title
  ></svelte:head
>
<div class="min-w-0 space-y-5">
  <Breadcrumb
    items={[
      { label: t("grants.apps", "Apps"), href: "/app/apps" },
      { label: data.app.name, href: `/app/apps/${data.app.id}` },
      { label: t("grants.title", "Grants") },
    ]}
  />
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
    {t("grants.title", "Grants")}
  </h1>
  <div>
    <div class="text-sm">{data.app.name}</div>
    <div class="mt-1"><Urn value={data.app.urn} linked /></div>
  </div>
  <!-- portal#2581: "Grant created." is spoken from this region, which exists before the create; the visible
       confirmation inside the result section is hidden from assistive technology so it is not read twice. Keyed on the grant, so a second create is a new element and is announced again. -->
  <LiveRegion>{#if !current}<p>{t("grants.loading", "Loading…")}</p>{:else if returned}{#key returned.id}<p class="sr-only">{t("grants.created-confirmation", "Grant created.")}</p>{/key}{/if}</LiveRegion>
  {#if current}
    {#if feedback && !(form && "operation" in form && form.operation === "create")}<p
        role="alert"
        class="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200"
      >
        {feedback}
      </p>{/if}
    {#if returned}
      <section
        aria-label={t("grants.result", "Request result")}
        class="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
      >
        <p aria-hidden="true" class="mb-3">
          {t("grants.created-confirmation", "Grant created.")}
        </p>
        <GrantRecord
          approvalStatus={data.signing}
          {now}
          grant={returned}
          {actors}
          node={returnedNode}
          holder={returnedHolder}
        />
      </section>
    {/if}
    {#if data.impersonating}<p class="text-sm">
        {t(
          "grants.impersonating",
          "You are viewing as another person. Grants can be read here but not changed. End impersonation to revoke or create grants.",
        )}
      </p>{/if}
    <label class="block space-y-1 text-sm">
      <span>{t("grants.filter.scope", "Show grants on this page")}</span>
      <select
        aria-label={t("grants.filter.scope", "Show grants on this page")}
        bind:value={pageFilter}
        class="min-h-11 max-w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="all"
          >{t("grants.filter.all", "All grants on this page")}</option
        >
        <option value="pending"
          >{t("grants.filter.pending", "Pending on this page")}</option
        >
        <option value="mine"
          >{t("grants.filter.mine", "Approved by me on this page")}</option
        >
      </select>
    </label>
    <DataTable
      {table}
      bind:globalFilter
      listKey="app-grants"
      searchPlaceholder={t("grants.search", "Search this page…")}
      searchAriaLabel={t("grants.search-label", "Search grants on this page")}
      showFooter={false}
      fitOnPhone
    >
      {#snippet cell(c)}<GrantRecord
          approvalStatus={data.signing}
          {now}
          grant={c.row.original}
          holder={holders[grantHolderKey(c.row.original)]}
          {actors}
          node={nodes?.[grantNodeRef(c.row.original, actionDefinitions) ?? ""]}
          actionAlreadyRevoked={rowUpdates[c.row.original.id]?.alreadyRevoked ??
            (!!form &&
              "alreadyRevoked" in form &&
              form.alreadyRevoked === true)}
          actionGrant={rowUpdates[c.row.original.id]?.grant ??
            (form &&
            "grant" in form &&
            form.grant &&
            form.operation === "revoke" &&
            form.appId === data.app.id &&
            form.grant.id === c.row.original.id
              ? form.grant
              : null)}
          onresult={(g, alreadyRevoked) => {
            if (g.appId === data.app.id)
              rowUpdates = {
                ...rowUpdates,
                [g.id]: { grant: g, alreadyRevoked },
              };
          }}
          locked={creating || reading}
          {ownershipEpoch}
          onbegin={beginRowWrite}
          revokeAction={data.impersonating
            ? undefined
            : `?/revoke&offset=${data.offset}`}
        />
        <GrantApproval
          grant={c.row.original}
          enabled={data.signing}
          {now}
          offset={data.offset}
          locked={creating || reading || rowWrites > 0}
          onbegin={startCeremony}
        />
      {/snippet}
    </DataTable>
    {#if !rows.length}<p>
        {pageFilter === "pending"
          ? t("grants.empty.pending", "No pending grants on this page.")
          : pageFilter === "mine"
            ? t("grants.empty.mine", "No grants approved by you on this page.")
            : t("grants.empty", "No grants on this page.")}
      </p>{/if}
    {#if rows.length && table.getRowModel().rows.length === 0}<p>
        {t("grants.no-matches", "No grants match this page’s search.")}
      </p>{/if}
    <nav
      aria-label={t("grants.pages", "Grant pages")}
      class="flex flex-wrap items-center gap-4 text-sm"
    >
      <span
        >{t("grants.total", "{total} grants", {
          total: grants.total,
        })}{#if refreshFailed}
          · {t("grants.maybe-stale", "may be out of date")}{/if}</span
      >
      <a
        class="min-h-11 inline-flex items-center text-indigo-600 dark:text-indigo-300"
        href={href(data.offset)}
        data-sveltekit-reload>{t("grants.refresh", "Refresh")}</a
      >
      {#if data.offset > 0}<a
          class="min-h-11 inline-flex items-center text-indigo-600 dark:text-indigo-300"
          href={href(Math.max(0, data.offset - 20))}
          >{t("grants.previous", "Previous")}</a
        >{/if}
      {#if grants.items.length && data.offset + grants.items.length < grants.total}<a
          class="min-h-11 inline-flex items-center text-indigo-600 dark:text-indigo-300"
          href={href(data.offset + grants.items.length)}
          >{t("grants.next", "Next")}</a
        >{/if}
    </nav>
    {#if refreshFailed && refreshPurpose === "approval"}<p role="alert">
        {t(
          "grants.approval-refresh-failed",
          "The grants could not refresh. Use Refresh to load the server’s result.",
        )}
        <a
          class="inline-flex min-h-11 items-center text-indigo-600 dark:text-indigo-300"
          href={href(data.offset)}
          data-sveltekit-reload>{t("grants.refresh", "Refresh")}</a
        >
      </p>{/if}
    {#if data.signing}
      {#key data.app.id}
        <section
          class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 class="text-xl font-semibold">
            {t("grants.create-title", "Create a grant")}
          </h2>

          {#if actionDefinitionsFailed}<p role="alert" class="mt-3 text-sm">{t("grants.actions.failed", "Actions could not be loaded. Refresh before creating a grant.")}</p>
          {:else if !actionDefinitions.length}<p class="mt-3 text-sm">{t("grants.actions.empty", "No actions you can grant here.")}</p>
          {:else if data.choices.failed}<p role="alert" class="mt-3 text-sm">
              {t(
                "grants.choices.failed",
                "The holder choices could not be loaded. Refresh before creating a grant.",
              )}
            </p>{:else}
            <form
              method="POST"
              use:enhance={submitCreate}
              action={`?/create&offset=${data.offset}`}
              class="mt-4 max-w-xl space-y-4"
            >
              <div class="text-sm">
                <label for="grant-holder">{t("grants.holder", "Holder")}</label
                ><select
                  id="grant-holder"
                  name="holder"
                  bind:value={holderChoice}
                  required
                  class={field}
                >
                  <option value=""
                    >{t("grants.choose-holder", "Choose a holder")}</option
                  >
                  <optgroup label={t("grants.workers", "Workers")}
                    >{#each data.choices.workers as worker}<option
                        value={`WORKER:${worker.id}`}>{worker.name}</option
                      >{/each}</optgroup
                  >
                  <optgroup label={t("grants.agents", "Agents")}
                    >{#each data.choices.agents as agent}<option
                        value={`AGENT:${agent.id}`}>{agent.name}</option
                      >{/each}</optgroup
                  >
                </select>
                {#if pickedHolder?.urn}<div class="mt-1">
                    <Urn value={pickedHolder.urn} linked />
                  </div>{/if}
              </div>
              <div class="text-sm">
                <label for="grant-action">{t("grants.action", "Action")}</label
                ><select id="grant-action" name="action" class={field}
                  value={chosenAction?.name ?? ""}
                  onchange={(event) => { actionName = event.currentTarget.value; parameterNodes = {}; picker = false; }}
                  >{#each actionDefinitions as action (action.name)}<option
                      value={action.name} disabled={!grantableAction(action)}>{action.name}</option
                    >{/each}</select>
              </div>
              {#if actionDefinitions.some((a) => !grantableAction(a))}
                <p class="text-sm">{t("grants.actions.unsupported", "Actions with unsupported parameter types cannot be granted here.")}</p>
              {/if}
              {#if chosenAction && grantableAction(chosenAction)}
                {#each chosenAction.parameters as parameter (parameter.name)}
                  {@const picked = Object.hasOwn(parameterNodes, parameter.name) ? parameterNodes[parameter.name] : undefined}
                  <div>
                    <span class="block text-sm">{parameter.name}</span>
                    {#if picked}<div class="mt-1 text-sm">{picked.name}</div>
                      <div class="mt-1"><Urn value={picked.urn} linked /></div>{/if}
                    <input type="hidden" name={"parameter:" + parameter.name} value={picked?.id ?? ""} />
                    <button type="button" onclick={() => { pickerParameter = parameter.name; pickerAction = chosenAction!.name; picker = true; }}
                      aria-label={t("grants.choose-parameter", "Choose a node… {name}", { name: parameter.name })}
                      aria-haspopup="dialog"
                      aria-expanded={picker && pickerParameter === parameter.name && pickerAction === chosenAction?.name}
                      class="mt-2 min-h-11 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700">{t("grants.choose-node", "Choose a node…")}</button>
                  </div>
                {/each}
              {/if}
              <label class="block text-sm"
                >{t("grants.reason", "Reason")}<textarea
                  name="reason"
                  required
                  bind:value={reason}
                  maxlength={GRANT_REASON_MAX * 2}
                  aria-invalid={reasonLength > GRANT_REASON_MAX}
                  aria-describedby="grant-reason-limit"
                  oninput={(event) =>
                    event.currentTarget.setCustomValidity(
                      [...event.currentTarget.value.trim()].length >
                        GRANT_REASON_MAX
                        ? grantReasonLimitMessage()
                        : "",
                    )}
                  class={field}
                ></textarea></label
              >
              <!-- Native maxlength counts UTF-16 units; custom validity enforces the server's code-point limit. -->
              <p
                id="grant-reason-limit"
                class="text-sm"
                class:text-red-800={reasonLength > GRANT_REASON_MAX}
                class:dark:text-red-200={reasonLength > GRANT_REASON_MAX}
              >
                {reasonLength > GRANT_REASON_MAX
                  ? grantReasonLimitMessage()
                  : t(
                      "grants.reason.hint",
                      "Reason: {count} of {max} characters (spaces at the ends do not count).",
                      {
                        count: String(reasonLength),
                        max: String(GRANT_REASON_MAX),
                      },
                    )}
              </p>
              <div class="text-sm">
                <label for="grant-starts"
                  >{t("grants.starts-input", "Starts at (UTC, optional)")}</label
                ><input
                  id="grant-starts"
                  type="datetime-local"
                  name="startsAt"
                  aria-describedby="grant-utc-hint"
                  class={field}
                />
              </div>
              <div class="text-sm">
                <label for="grant-expires"
                  >{t("grants.expires-input", "Expires at (UTC, optional)")}</label
                ><input
                  id="grant-expires"
                  type="datetime-local"
                  name="expiresAt"
                  aria-describedby="grant-utc-hint"
                  class={field}
                />
              </div>
              <p
                id="grant-utc-hint"
                class="text-sm text-zinc-600 dark:text-zinc-300"
              >
                {t(
                  "grants.utc-hint",
                  "Enter times in UTC, not your local time zone.",
                )}
              </p>
              <label class="block text-sm"
                >{t("grants.max-input", "Maximum uses (optional)")}<input
                  type="number"
                  name="maxUses"
                  min="1"
                  max="2147483647"
                  step="1"
                  class={field}
                /></label
              >
              {#if feedback && form && "operation" in form && form.operation === "create"}<p
                  role="alert"
                  class="text-sm text-red-800 dark:text-red-200"
                >
                  {feedback}
                </p>{/if}
              {#if localFailure}<p
                  role="alert"
                  class="text-sm text-red-800 dark:text-red-200"
                >
                  {localFailure}
                </p>{/if}
              <LiveRegion>{#if reading}<p>
                  {t("grants.refreshing", "Refreshing grants…")}
                </p>{/if}</LiveRegion>
              <LiveRegion>
                {#if rowWrites}<p>
                    {t("grants.wait-revoke", "Finishing the revoke request…")}
                  </p>{/if}
              </LiveRegion>
              {#if refreshFailed && refreshPurpose === "create"}<p role="alert">
                  {t(
                    "grants.refresh-failed",
                    "Grant created, but the list could not refresh. Use Refresh to load the latest grants.",
                  )}
                  <a
                    class="inline-flex min-h-11 items-center text-indigo-600 dark:text-indigo-300"
                    href={href(data.offset)}
                    data-sveltekit-reload>{t("grants.refresh", "Refresh")}</a
                  >
                </p>{/if}
              <p class="text-sm text-zinc-600 dark:text-zinc-300">
                {t(
                  "grants.signature-note",
                  "A new grant needs a signature to take effect. Creating it does not activate it.",
                )}
              </p>
              {#if missingChoices.length}<p
                  id="grant-create-needs"
                  class="text-sm text-zinc-600 dark:text-zinc-300"
                >
                  {t("grants.create-needs", "To create a grant, choose: {what}.", {
                    what: missingChoices.join(", "),
                  })}
                </p>{/if}
              {#if chosenAction && grantableAction(chosenAction)}<button
                aria-describedby={missingChoices.length ? "grant-create-needs" : undefined}
                disabled={chosenAction.parameters.some((p) => !Object.hasOwn(parameterNodes, p.name)) || creating || reading || rowWrites > 0}
                class="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >{t("grants.create", "Create")}</button
              >{/if}
            </form>
          {/if}
        </section>
        {#await data.memories}<p role="status">
            {t("grants.nodes.loading", "Loading node choices…")}
          </p>{:then memories}
          <SelectNode
            bind:open={picker}
            memories={memories.kind === "ok" ? memories.value : []}
            memoriesFailed={memories.kind === "failed"}
            onselect={(choice) => {
              if (picker && chosenAction?.name === pickerAction && chosenAction.parameters.some((p) => p.name === pickerParameter))
                parameterNodes = { ...parameterNodes, [pickerParameter]: choice };
              picker = false;
            }}
          />
        {/await}
      {/key}
    {/if}
  {/if}
</div>
