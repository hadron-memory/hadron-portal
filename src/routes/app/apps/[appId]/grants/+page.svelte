<script lang="ts">
  import { onDestroy } from "svelte";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { page } from "$app/state";
  import Breadcrumb from "$lib/components/Breadcrumb.svelte";
  import Urn from "$lib/components/Urn.svelte";
  import DataTable from "$lib/components/table/DataTable.svelte";
  import SelectNode from "$lib/components/SelectNode.svelte";
  import { makeGlobalFilterFn } from "$lib/table/global-filter";
  import { createSvelteTable } from "$lib/table/createSvelteTable.svelte";
  import type { PortalColumnDef } from "$lib/table/features";
  import { grantActions, grantError, type Grant } from "$lib/grants/types";
  import type { NodeChoice } from "$lib/node-choices";
  import { t } from "$lib/i18n/t";
  import GrantRecord from "./GrantRecord.svelte";
  import type { PageData, ActionData } from "./$types";
  let { data, form }: { data: PageData; form?: ActionData } = $props();
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  let creating = $state(false),
    refreshFailed = $state(false);
  let localFailure = $state<string | null>(null);
  const submitCreate: SubmitFunction = ({ cancel }) => {
    if (creating) {
      cancel();
      return;
    }
    const appId = data.routeRef;
    creating = true;
    refreshFailed = false;
    localFailure = null;
    return async ({ result, update }) => {
      try {
        if (!alive || page.params.appId !== appId) return;
        if (!["success", "failure", "redirect"].includes(result.type)) {
          localFailure = grantError(null);
          return;
        }
        await update({
          reset: result.type === "success",
          invalidateAll: false,
        });
        if (result.type === "success") {
          node = null;
          holderChoice = "";
          try {
            await invalidateAll();
          } catch {
            refreshFailed = true;
          }
        }
      } finally {
        creating = false;
      }
    };
  };
  let holderChoice = $state("");
  const pickedHolder = $derived(
    holderChoice.startsWith("WORKER:")
      ? data.choices.workers.find((w) => `WORKER:${w.id}` === holderChoice)
      : data.choices.agents.find((a) => `AGENT:${a.id}` === holderChoice),
  );
  let node = $state<NodeChoice | null>(null),
    picker = $state(false);
  $effect.pre(() => {
    data.app.id;
    node = null;
    holderChoice = "";
    picker = false;
    creating = false;
    refreshFailed = false;
    localFailure = null;
  });
  let rowUpdates = $state<Record<string, Grant>>({});
  $effect.pre(() => {
    data.grants;
    rowUpdates = {};
  });
  const current = $derived(page.params.appId === data.routeRef);
  const rows = $derived(current ? data.grants.items : []);
  let globalFilter = $state("");
  const columns: PortalColumnDef<Grant>[] = [
    {
      id: "grant",
      header: t("grants.column", "Grant"),
      accessorFn: (g) =>
        `${data.holders[`${g.holderKind}:${g.holderId}`]?.name ?? ""} ${g.action} ${g.reason} ${g.id} ${JSON.stringify(g.values)}`,
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
  const returned = $derived(
    form &&
      "grant" in form &&
      form.appId === data.app.id &&
      form.operation === "create"
      ? form.grant
      : null,
  );
  const feedback = $derived(form && "error" in form ? form.error : null);
  const field =
    "w-full min-h-11 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";
  function href(offset: number) {
    return `?offset=${offset}`;
  }
</script>

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
  {#if !current}<p role="status">{t("grants.loading", "Loading…")}</p>{:else}
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
        <p role="status" class="mb-3">
          {form && "operation" in form && form.operation === "create"
            ? t(
                "grants.created-note",
                "Grant created. It needs a signature to take effect.",
              )
            : t("grants.revoke-result", "The grant returned by the server:")}
        </p>
        <GrantRecord
          grant={returned}
          holder={data.holders[`${returned.holderKind}:${returned.holderId}`]}
        />
      </section>
    {/if}
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
          grant={c.row.original}
          holder={data.holders[
            `${c.row.original.holderKind}:${c.row.original.holderId}`
          ]}
          actionGrant={rowUpdates[c.row.original.id] ??
            (form &&
            "grant" in form &&
            form.grant &&
            form.appId === data.app.id &&
            form.grant.id === c.row.original.id
              ? form.grant
              : null)}
          onresult={(g) => {
            if (g.appId === data.app.id)
              rowUpdates = { ...rowUpdates, [g.id]: g };
          }}
          locked={creating}
          revokeAction={`?/revoke&offset=${data.offset}`}
        />{/snippet}
    </DataTable>
    {#if !rows.length}<p>{t("grants.empty", "No grants on this page.")}</p>{/if}
    {#if rows.length && table.getRowModel().rows.length === 0}<p>
        {t("grants.no-matches", "No grants match this page’s search.")}
      </p>{/if}
    <nav
      aria-label={t("grants.pages", "Grant pages")}
      class="flex flex-wrap items-center gap-4 text-sm"
    >
      <span
        >{t("grants.total", "{total} grants", {
          total: data.grants.total,
        })}</span
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
      {#if rows.length && data.offset + rows.length < data.grants.total}<a
          class="min-h-11 inline-flex items-center text-indigo-600 dark:text-indigo-300"
          href={href(data.offset + rows.length)}>{t("grants.next", "Next")}</a
        >{/if}
    </nav>
    {#if data.signing}
      {#key data.app.id}
        <section
          class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 class="text-xl font-semibold">
            {t("grants.create-title", "Create a grant")}
          </h2>

          {#if data.choices.failed}<p role="alert" class="mt-3 text-sm">
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
                  >{#each Object.keys(grantActions) as action}<option
                      value={action}>{action}</option
                    >{/each}</select
                >
              </div>
              <div>
                <span class="text-sm">{t("grants.node", "Node")}</span>
                {#if node}<div class="mt-1 text-sm">{node.name}</div>
                  <div class="mt-1"><Urn value={node.urn} linked /></div>{/if}
                <input type="hidden" name="nodeId" value={node?.id ?? ""} />
                <button
                  type="button"
                  onclick={() => (picker = true)}
                  class="mt-2 min-h-11 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700"
                  >{t("grants.choose-node", "Choose a node…")}</button
                >
              </div>
              <label class="block text-sm"
                >{t("grants.reason", "Reason")}<textarea
                  name="reason"
                  required
                  maxlength="4000"
                  class={field}
                ></textarea></label
              >
              <label class="block text-sm"
                >{t("grants.starts-input", "Starts at (UTC, optional)")}<input
                  type="datetime-local"
                  name="startsAt"
                  class={field}
                /></label
              >
              <label class="block text-sm"
                >{t("grants.expires-input", "Expires at (UTC, optional)")}<input
                  type="datetime-local"
                  name="expiresAt"
                  class={field}
                /></label
              >
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
              {#if localFailure}<p role="alert">{localFailure}</p>{/if}
              {#if refreshFailed}<p role="alert">
                  {t(
                    "grants.refresh-failed",
                    "The request succeeded, but the list could not refresh. Refresh before trying another request.",
                  )}
                </p>{/if}
              <p class="text-sm text-zinc-600 dark:text-zinc-300">
                {t(
                  "grants.signature-note",
                  "A new grant needs a signature to take effect. Creating it does not activate it.",
                )}
              </p>
              <button
                disabled={!node || creating}
                class="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >{t("grants.create", "Create")}</button
              >
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
              node = choice;
              picker = false;
            }}
          />
        {/await}
      {/key}
    {/if}
  {/if}
</div>
