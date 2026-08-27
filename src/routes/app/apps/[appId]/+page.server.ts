import { fail, error, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import {
  ORGANIZATION_QUERY,
  APP_QUERY,
  MY_AGENTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  UPDATE_APP_MUTATION,
  ADD_AGENT_TO_APP_MUTATION,
  REMOVE_AGENT_FROM_APP_MUTATION,
  CREATE_APP_KEY_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  DELETE_APP_MUTATION,
  APP_NODES_QUERY,
  AI_SERVICE_CONFIGS_QUERY,
  RESOLVE_AI_SERVICE_CONFIGS_QUERY,
  WORKERS_QUERY,
  CAST_WORKER_MUTATION,
  RETIRE_WORKER_MUTATION,
  RELEASE_WORKER_MUTATION,
  TEAM_CHAT_MESSAGES_QUERY,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  TEAM_WORK_ITEMS_QUERY,
  APP_CHAT_ROOTS_QUERY,
} from '$lib/server/queries';
import { normalizeFilter, normalizeKind } from '$lib/components/worklog';
import { AGENT_CHAT_KEY, TEAM_CHAT_LOC, buildAppChatList, resolveSelectedChat } from '$lib/app-chats';
import { loadTeamChatTail } from '$lib/server/team-chat';
import { loadChatMessages } from '$lib/server/team-chat';
import type {
  Organization,
  App,
  MemoryNode,
  AiServiceConfig,
  Worker,
  TeamChatMessage,
  TeamWorkItem,
} from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  addAgentSchema,
  appSettingsSchema,
  castWorkerSchema,
  createAppKeySchema,
  deleteAppSchema,
  removeAppAgentSchema,
  postTeamChatMessageSchema,
  retireWorkerSchema,
  releaseWorkerSchema,
  revokeAppKeySchema,
  updateAppAgentToolsSchema,
} from './schema';

type AddAgentForm = Infer<typeof addAgentSchema, 'zod4'>;
type AppSettingsForm = Infer<typeof appSettingsSchema, 'zod4'>;
type CastWorkerForm = Infer<typeof castWorkerSchema, 'zod4'>;
type CreateAppKeyForm = Infer<typeof createAppKeySchema, 'zod4'>;
type DeleteAppForm = Infer<typeof deleteAppSchema, 'zod4'>;
type PostTeamChatMessageForm = Infer<typeof postTeamChatMessageSchema, 'zod4'>;
type RemoveAppAgentForm = Infer<typeof removeAppAgentSchema, 'zod4'>;
type RetireWorkerForm = Infer<typeof retireWorkerSchema, 'zod4'>;
type ReleaseWorkerForm = Infer<typeof releaseWorkerSchema, 'zod4'>;
type RevokeAppKeyForm = Infer<typeof revokeAppKeySchema, 'zod4'>;
type UpdateAppAgentToolsForm = Infer<typeof updateAppAgentToolsSchema, 'zod4'>;

// Route-local, but a `/* GraphQL */` const rather than an inline string so
// `pnpm gql:validate` sees it — an inline document is invisible to the gate
// (#690 review), which is how this one kept `ref: $id` after the sweep.
const APP_ORG_QUERY = /* GraphQL */ `
  query AppOrg($ref: ID!) {
    app(ref: $ref) {
      organizationId
    }
  }
`;

const addAgentFormAdapter = zod4(addAgentSchema);
const appSettingsFormAdapter = zod4(appSettingsSchema);
const castWorkerFormAdapter = zod4(castWorkerSchema);
const createAppKeyFormAdapter = zod4(createAppKeySchema);
const deleteAppFormAdapter = zod4(deleteAppSchema);

const postTeamChatMessageFormAdapter = zod4(postTeamChatMessageSchema);
const removeAppAgentFormAdapter = zod4(removeAppAgentSchema);
const retireWorkerFormAdapter = zod4(retireWorkerSchema);
const releaseWorkerFormAdapter = zod4(releaseWorkerSchema);
const revokeAppKeyFormAdapter = zod4(revokeAppKeySchema);
const updateAppAgentToolsFormAdapter = zod4(updateAppAgentToolsSchema);

/**
 * Staffing is gated server-side on a three-branch OR (an org member with
 * CONTRIBUTOR+ on the App's org, a non-`reader` AppMember of an org-owned App,
 * or the owner of a user-owned App — never under impersonation). The portal
 * deliberately does NOT re-derive that predicate to pre-hide the controls:
 *
 *   - `App.role` is the App's DEFAULT member role column (it feeds the Settings
 *     form), NOT the caller's role — gating on it would hide casting from an
 *     org CONTRIBUTOR/ADMIN who isn't an AppMember at all, i.e. the primary
 *     intended caller.
 *   - A wrong guess in the hiding direction is worse than one in the showing
 *     direction: a hidden control is an unexplained dead end, a refused one is
 *     a sentence. The server's gate IS the auth (see the loader's note on
 *     `app(ref:)`), and duplicating it here is exactly the drift this repo
 *     avoids elsewhere.
 *
 * So a caller who can't staff learns it from a legible refusal rather than a
 * raw server string. Raised by Codex on PR #716.
 */
const STAFFING_FORBIDDEN = () => t(
  'app.staff.error.forbidden',
  'You don’t have permission to staff this App. Casting and retiring need contributor access to the organization, or a non-reader role in the App.',
);

/**
 * releaseWorker's refusal, which does NOT share the staffing gate above.
 *
 * `releaseWorker` admits exactly two principals, and they are different acts:
 * the HOLDER releasing their own name, or an App/org ADMIN force-releasing
 * somebody else's. Casting and retiring admit a third — a contributor, or a
 * non-reader App member — so reusing STAFFING_FORBIDDEN here told a contributor
 * who is not the holder that they already have the access they need, which is
 * the one thing a permission message must never do (@codex and @copilot, both,
 * on #766).
 */
const RELEASE_FORBIDDEN = () => t(
  'app.staff.error.release-forbidden',
  'You don’t have permission to release this name. You can release a name you hold yourself; force-releasing someone else’s needs admin access to the App or its organization.',
);

/**
 * castWorker's typed refusals (#974), mapped to copy that says what to DO.
 * The raw server message names internals ("no installed agent matches role
 * X"), and the codes are a documented contract, so branching on the code is
 * both stabler and more actionable than echoing the message.
 */
const CAST_WORKER_ERRORS: Record<string, () => string> = {
  FORBIDDEN: STAFFING_FORBIDDEN,
  WORKER_NAME_TAKEN: () => t(
    'app.staff.error.name-taken',
    'That name is already taken in this App. Worker names are reserved permanently, including for retired workers — pick another.',
  ),
  WORKER_AGENT_NOT_INSTALLED: () => t(
    'app.staff.error.agent-not-installed',
    'That agent is not installed in this App. Install it first, then cast it.',
  ),
  WORKER_AGENT_NOT_FOUND: () => t(
    'app.staff.error.agent-not-found',
    'No installed agent matches that role. Pick an agent explicitly.',
  ),
  WORKER_AGENT_AMBIGUOUS: () => t(
    'app.staff.error.agent-ambiguous',
    'Several installed agents match that role. Pick an agent explicitly.',
  ),
  // #760: WORKER_NAME_REQUIRED replaced WORKER_REGISTER_EXHAUSTED when
  // hadron-server#1050 removed the cast-list register. The old code can no
  // longer fire — there is no register to exhaust — and the new one had no
  // mapping, so the single refusal a user could actually hit fell through to
  // the raw server string.
  //
  // The form now requires a name, so this should be unreachable from the
  // portal. It is mapped anyway: a refusal that arrives despite client-side
  // validation means the two have drifted, and a legible sentence beats a raw
  // code for whoever is reading the screen when that happens.
  WORKER_NAME_REQUIRED: () => t(
    'app.staff.error.name-required',
    'A worker needs a name. The platform no longer picks one — choose a name that is not already used in this App.',
  ),
  APP_UNINSTALLED: () => t(
    'app.staff.error.app-uninstalled',
    'This App has been uninstalled, so nothing can be cast into it.',
  ),
};

/**
 * createTeamChatMessage's typed refusals (#939/#941/#974) worth naming.
 *
 * The session-related codes are deliberately ABSENT: the portal posts without a
 * `sessionRef` (there is no worker session behind a browser), so
 * SESSION_NOT_IN_APP, SESSION_ENDED, SESSION_NOT_WORKER_BOUND and
 * WORKER_RETIRED are unreachable from here. Mapping them would be inventing
 * copy for states this surface cannot produce, and would go stale invisibly
 * (review:clienterror-map-known-codes-only).
 */
const TEAM_CHAT_POST_ERRORS: Record<string, () => string> = {
  FORBIDDEN: () => t(
    'app.team-chat.error.forbidden',
    'You do not have access to post in this team chat. Posting needs App membership, or contributor access on the App’s organization.',
  ),
  TEAM_CHAT_BODY_TOO_LARGE: () => t(
    'app.team-chat.error.too-large',
    'That message is too long for the team chat (65536 characters max).',
  ),
  TEAM_CHAT_REPLY_NOT_FOUND: () => t(
    'app.team-chat.error.reply-not-found',
    'The message you are replying to no longer exists. Reload the team chat and try again.',
  ),
  // First-post bootstrap has to locate the Team Agent to create the chat root.
  // Both of these mean the App is not shaped like a team yet, which is a
  // configuration answer rather than a retry.
  TEAM_AGENT_NOT_FOUND: () => t(
    'app.team-chat.error.no-team-agent',
    'This App has no team agent, so its team chat cannot be started. Install an agent into the App first.',
  ),
  TEAM_AGENT_AMBIGUOUS: () => t(
    'app.team-chat.error.ambiguous-team-agent',
    'Several installed agents could own this App’s team chat, so it cannot be started automatically. Mark one as the team agent.',
  ),
  APP_UNINSTALLED: () => t(
    'app.team-chat.error.app-uninstalled',
    'This App has been uninstalled, so its team chat is read-only.',
  ),
};

/**
 * The `extensions.code` of a graphql-request ClientError, when it carries one.
 *
 * Returns null for a transport-level failure (no GraphQL errors payload) and
 * for any code that isn't a string, so callers fall through to the server's own
 * message rather than mislabelling an outage as a user mistake
 * (review:clienterror-map-known-codes-only).
 */
function gqlErrorCode(e: unknown): string | null {
  const errors = (e as { response?: { errors?: Array<{ extensions?: { code?: unknown } }> } })
    ?.response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const code = errors[0]?.extensions?.code;
  return typeof code === 'string' ? code : null;
}

function slugOfUrn(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

// Same cap and same reasoning as TEAM_CHAT_PAGE_SIZE: ask for the server's
// maximum, and report the server's `total` so a truncated view can say so
// rather than reading as the whole worklog.
const WORKLOG_PAGE_SIZE = 200;
/**
 * #744 — how much of an arbitrary chat's transcript is fetched.
 *
 * The tab discloses when it has hit this, rather than presenting a partial
 * transcript as a whole one (Codex P2 on #759). Deliberately generous: a 1:1
 * chat past 500 messages is unusual, and the honest caption costs nothing when
 * it is not reached.
 */
const CHAT_PAGE_SIZE = 500;

/** The App page's tab ids, for validating `?tab=`. Kept in sync with the
 *  `TabId` union in +page.svelte; an unknown value falls back to the default. */
const APP_TAB_IDS: readonly string[] = ['chats', 'worklog', 'staff', 'memory', 'settings', 'client'];

/**
 * #744 folded the separate `chat` (agent) and `team-chat` tabs into one `chats`
 * tab. Those ids are in the wild — in PR descriptions, team-chat messages and
 * anyone's bookmarks — so they still resolve, to the Chats tab with the right
 * conversation preselected. Dropping them would land the reader on the default
 * tab with no indication anything was redirected.
 *
 * Kept as an explicit alias map rather than a silent fallback: an unknown tab
 * SHOULD fall back, a retired-but-known one should land where it moved to.
 */
const RETIRED_TAB_ALIASES: Record<string, { tab: string; chat: string }> = {
  chat: { tab: 'chats', chat: AGENT_CHAT_KEY },
  'team-chat': { tab: 'chats', chat: TEAM_CHAT_LOC },
};

export const load: PageServerLoad = async ({ params, locals, url }) => {
  // #785: this load no longer carries the team chat's refresh. The poll reads
  // `team-chat/+server.ts` directly, because a background tick must not be able
  // to re-run THIS function — its failure paths are fatal (a 404 on an org
  // blip, 500s on transport) and would replace a working page with an error
  // page on a timer.
  // Worklog filters ride the URL rather than component state, because `ref`
  // lookup — "which worker sessions produced this PR?" — is the question the
  // worklog exists to answer, and an answer you cannot link to is half an
  // answer. They are applied SERVER-side: `teamWorkItems` normalizes a ref
  // tool-awarely, so a pasted PR URL and the short form find the same records.
  // A client-side compare over the loaded page would match neither reliably,
  // and would silently search only the fetched window.
  const worklogRef = normalizeFilter(url.searchParams.get('worklogRef'));
  const worklogKind = normalizeKind(url.searchParams.get('worklogKind'));
  const worklogTool = normalizeFilter(url.searchParams.get('worklogTool'));

  // `?tab=` so a filtered worklog URL lands on the worklog rather than the
  // page's default tab. Validated against the known set and coerced to null
  // otherwise — an unknown value falls back to the default rather than
  // rendering a blank page where no tab body matches.
  const rawTab = url.searchParams.get('tab');
  const alias = rawTab ? RETIRED_TAB_ALIASES[rawTab] : undefined;
  const initialTab = alias ? alias.tab : APP_TAB_IDS.includes(rawTab ?? '') ? rawTab : null;
  // An explicit ?chat= wins over the one a retired tab id implies, so a link
  // carrying both is not silently overridden by the alias.
  const requestedChat = url.searchParams.get('chat') ?? alias?.chat ?? null;
  // #648: canonical org-optional App detail. No requireNonConsumer — this
  // resolves BOTH org-owned apps (member-gated) and user-owned (org-less) apps
  // (owner-gated) through one owner-accessible path, exactly like /app/agents/[id]
  // (#641). The server's app(ref:) gate IS the auth; a non-owner/non-member gets
  // null → 404 (no over-exposure).
  const client = gqlClient(locals.token);
  const [appData, configsData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { ref: params.appId })
      .catch((e) => {
        // graphql-request throws on ANY GraphQL error even when usable data is
        // present. A non-critical NULLABLE field erroring (e.g. installedAgentUrn,
        // whose composeInstalledAgentUrn throws on a malformed app/agent urn)
        // must not 404 the whole page — salvage the app from the partial
        // response so it stays viewable/editable. A genuinely missing app (no
        // data) still falls through to the 404 below. Only a GraphQL error
        // carries `response`; rethrow transport/network errors so they surface
        // as a 500, not a misleading 404.
        if (e && typeof e === 'object' && 'response' in e) {
          const partial = (e as { response?: { data?: { app?: App | null } } }).response?.data;
          return { app: partial?.app ?? null };
        }
        throw e;
      }),
    // 036: APP-owned named configs. org-ADMIN gated server-side; a non-admin
    // member's call errors (the page hides the manager for them anyway).
    // Coerce to null so a transient failure surfaces as a load error to admins
    // instead of a misleading empty list.
    fetchAllItems<AiServiceConfig>(client, AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs', {
      ownerType: 'APP', ownerId: params.appId,
    }).catch(() => null),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  const app = appData.app;

  // Org chrome only for an org-owned app; a user-owned (org-less) app (spec 047)
  // has none. availableAgents (installable when no Agent is linked yet) = the
  // org's agents for an org app, or the caller's own personal agents ∪ PUBLIC
  // agents for an org-less app — mirroring the server install gate (createApp: a
  // personal App may install a PUBLIC or the caller's OWN personal agent).
  let org: Organization | null = null;
  let availableAgents: Array<{ id: string; name: string; urn: string }> = [];
  if (app.organizationId) {
    const orgData = await client
      .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { ref: app.organizationId })
      .catch(() => ({ organization: null }));
    if (!orgData.organization) throw error(404, 'Organization not found');
    org = orgData.organization;
    availableAgents = app.agentId ? [] : (org.agents ?? []);
  } else if (!app.agentId) {
    const [mine, publicAgents] = await Promise.all([
      // #782: MY_AGENTS_QUERY is scoped server-side (filter.ownedByMe), so it's
      // already the caller's own org-less agents — no client-side filter needed.
      fetchAllItems<{ id: string; name: string; urn: string }>(
        client, MY_AGENTS_QUERY, 'agents',
      ).catch(() => []),
      fetchAllItems<{ id: string; name: string; urn: string }>(
        client, PUBLIC_AGENTS_QUERY, 'publicAgents',
      ).catch(() => []),
    ]);
    // Dedupe by id — a public agent could also be the caller's own.
    const seen = new Set<string>();
    availableAgents = [...mine, ...publicAgents].filter((a) =>
      seen.has(a.id) ? false : (seen.add(a.id), true),
    );
  }

  // Memory tab nodes — only relevant when the App has memory access via its agents,
  // but the query is cheap and lets the Memory tab render uniformly.
  // 036: in parallel, the configs RESOLVABLE for the App's chat context
  // (App→Agent→Org→Host, masked) — powers the chat tab's config picker +
  // LLM-readiness gate. App-membership gated; coerce errors to null (unknown
  // ⇒ the page treats readiness as "don't block"). Only meaningful with an
  // agent linked.
  const [nodesData, chatConfigs, staff, teamChat, worklog, chatRoots] = await Promise.all([
    client
      .request<{ appNodes: MemoryNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: 500 })
      .catch(() => ({ appNodes: [] as MemoryNode[] })),
    app.agentId
      ? client
          .request<{ resolveAiServiceConfigs: AiServiceConfig[] }>(RESOLVE_AI_SERVICE_CONFIGS_QUERY, {
            appRef: params.appId,
            agentRef: app.agentId,
          })
          .then((r) => r.resolveAiServiceConfigs)
          .catch(() => null)
      : Promise.resolve(null),
    // #974: the App's STAFF — its Workers. includeRetired because a retired
    // worker still holds its name forever, so hiding it turns the eventual
    // WORKER_NAME_TAKEN into a mystery. Coerced to null (never []) on failure:
    // "couldn't load the staff" and "this App has no staff yet" are different
    // statements and the empty state must not tell the second lie
    // (review:no-silent-loader-catch).
    fetchAllItems<Worker>(client, WORKERS_QUERY, 'workers', {
      appRef: params.appId,
      includeRetired: true,
    }).catch((e) => {
      console.warn(`[app-staff] workers fetch failed for ${params.appId}:`, e);
      return null;
    }),
    // #732: the App's TEAM CHAT transcript, read through the canonical
    // `teamChatMessages` operation. Deliberately NOT via appNodes — the chat
    // lives in the App's class='app' shared memory, which that resolver cannot
    // reach (hadron-server#1031); going through the operation keeps this
    // surface off that dependency and returns the author envelope besides.
    //
    // Reads never provision: an App whose chat has not been bootstrapped
    // answers with an empty page rather than erroring, so "no messages yet" is
    // a real state and not a failure.
    //
    // Coerced to null (never an empty page) on failure, for the same reason as
    // the staff fetch above: "couldn't load the team chat" and "the team chat
    // is empty" are different statements (review:no-silent-loader-catch).
    loadTeamChatTail(client, params.appId).catch((e) => {
      console.warn(`[team-chat] transcript fetch failed for ${params.appId}:`, e);
      return null;
    }),
    // #733: the App's WORKLOG — the authoritative artifact-to-session join
    // (cor:agt:020:05). Same routing discipline as the team chat above: the
    // canonical operation, never appNodes.
    client
      .request<{ teamWorkItems: { items: TeamWorkItem[]; total: number } }>(TEAM_WORK_ITEMS_QUERY, {
        appRef: params.appId,
        ref: worklogRef,
        kind: worklogKind,
        tool: worklogTool,
        limit: WORKLOG_PAGE_SIZE,
      })
      .then((r) => r.teamWorkItems)
      .catch((e) => {
        console.warn(`[worklog] fetch failed for ${params.appId}:`, e);
        return null;
      }),
    // #744: the App's CHAT ROOTS, for the Chats selector. Server-side
    // nodeType filter, so this does not page an App's whole node set to find
    // two chats. Coerced to null (never []) on failure, for the same reason as
    // the staff and team-chat fetches: "couldn't load the chat list" and "this
    // App has one chat" are different statements.
    client
      .request<{ appNodes: MemoryNode[] }>(APP_CHAT_ROOTS_QUERY, {
        appRef: params.appId,
        limit: 200,
      })
      .then((r) => r.appNodes)
      .catch((e) => {
        console.warn(`[app-chats] chat-root fetch failed for ${params.appId}:`, e);
        return null;
      })
  ]);
  const [appSettingsForm, addAgentForm, createKeyForm, removeAgentForm, updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm, retireWorkerForm, releaseWorkerForm] = await Promise.all([
    superValidate<AppSettingsForm>(
      {
        name: appData.app.name,
        urn: slugOfUrn(appData.app.urn),
        appType: appData.app.appType,
        role: appData.app.role,
        description: appData.app.description ?? '',
        systemPrompt: appData.app.systemPrompt ?? '',
        createUserPermission: appData.app.createUserPermission,
        identifyUserMethod: appData.app.identifyUserMethod,
        sessionTimeoutSeconds: String(appData.app.sessionTimeoutSeconds),
        anonymousTtlDays: String(appData.app.anonymousTtlDays),
      },
      appSettingsFormAdapter,
      { errors: false },
    ),
    superValidate<AddAgentForm>(
      { agentId: '' },
      addAgentFormAdapter,
      { errors: false },
    ),
    superValidate<CreateAppKeyForm>(
      { label: '' },
      createAppKeyFormAdapter,
      { errors: false },
    ),
    superValidate<RemoveAppAgentForm>(
      { agentId: '' },
      removeAppAgentFormAdapter,
      { errors: false },
    ),
    superValidate<UpdateAppAgentToolsForm>(
      { agentTools: appData.app.agentTools ?? [] },
      updateAppAgentToolsFormAdapter,
      { errors: false },
    ),
    superValidate<RevokeAppKeyForm>(
      { keyId: '' },
      revokeAppKeyFormAdapter,
      { errors: false },
    ),
    superValidate<DeleteAppForm>(
      {},
      deleteAppFormAdapter,
      { errors: false },
    ),
    superValidate<CastWorkerForm>(
      { agentId: '' },
      castWorkerFormAdapter,
      { errors: false },
    ),
    superValidate<RetireWorkerForm>(
      { workerId: '' },
      retireWorkerFormAdapter,
      { errors: false },
    ),
    superValidate<ReleaseWorkerForm>(
      { workerId: '' },
      releaseWorkerFormAdapter,
      { errors: false },
    ),
  ]);
  const postTeamChatMessageForm = await superValidate<PostTeamChatMessageForm>(
    {},
    postTeamChatMessageFormAdapter,
    { errors: false },
  );

  // #744 — the App's chats as one browsable set.
  //
  // The agent chat is offered only when the App actually has one, matching the
  // condition the retired `chat` tab used, so an App with no linked agent does
  // not gain an entry that cannot render.
  const appChats = buildAppChatList(chatRoots ?? [], { hasAgentChat: !!app.agentId });
  const { selected: selectedChat, requestedMissing: chatNotFound } = resolveSelectedChat(
    appChats,
    requestedChat,
  );

  // Only an `other` chat needs loading here: the team chat came through its own
  // typed operation above (which returns the author envelope a node read
  // cannot), and the agent chat is fetched by its own component.
  //
  // Read-only by necessity, not by choice: the write surfaces are
  // `createTeamChatMessage` (team chat) and `sendChatMessage` (agent chat).
  // There is no operation to post into an arbitrary App chat, so the tab says
  // so rather than rendering a composer that cannot work.
  const selectedChatMessages =
    selectedChat?.kind === 'other' && selectedChat.memoryId
      ? await loadChatMessages(client, selectedChat.memoryId, selectedChat.key, CHAT_PAGE_SIZE)
          .catch((e) => {
            console.warn(`[app-chats] messages fetch failed for ${selectedChat.key}:`, e);
            return null;
          })
      : [];

  return {
    app,
    org,
    availableAgents,
    appNodes: nodesData.appNodes,
    chatConfigs,
    appConfigs: configsData ?? [],
    configsError: configsData === null,
    // #974: the App's staff. null = the fetch failed (distinct from []).
    staff,
    staffError: staff === null,
    // #732: the team chat transcript. null = the fetch failed (distinct from
    // an empty chat), and `teamChatTotal` is the SERVER's count, so a
    // transcript truncated at the page cap can say so instead of looking whole.
    teamChatMessages: teamChat?.items ?? [],
    teamChatTotal: teamChat?.total ?? 0,
    teamChatError: teamChat === null,
    // #733: the worklog page, plus the filters that produced it so the tab can
    // render its own controls from the URL rather than keeping a second copy of
    // that state in the component.
    worklog: worklog?.items ?? [],
    worklogTotal: worklog?.total ?? 0,
    worklogError: worklog === null,
    // #744: the App's chats, the one selected, and its transcript when that
    // chat is neither the team chat nor the agent chat. `chatsError` is the
    // discovery failing — distinct from an App that genuinely has one chat.
    appChats,
    chatsError: chatRoots === null,
    selectedChatKey: selectedChat?.key ?? null,
    selectedChatMessages: selectedChatMessages ?? [],
    selectedChatError: selectedChatMessages === null,
    // #744: hitting the cap is DISCLOSED rather than presented as a whole
    // transcript (Codex P2 on #759). `loadChatMessages` returns a plain list
    // with no total, so a full page is the only signal that more exists — the
    // same short-page reasoning as the worker page's sessions.
    selectedChatTruncated: (selectedChatMessages?.length ?? 0) >= CHAT_PAGE_SIZE,
    chatNotFound,
    initialTab,
    worklogFilters: {
      ref: worklogRef ?? '',
      // The NORMALIZED kind, not the raw param: echoing back a rejected value
      // would render a filter chip for a filter the server never applied.
      kind: worklogKind ?? '',
      tool: worklogTool ?? '',
    },
    currentUserId: locals.user?.id ?? null,
    appSettingsForm,
    addAgentForm,
    createKeyForm,
    removeAgentForm,
    updateAgentToolsForm,
    revokeKeyForm,
    deleteAppForm,
    castWorkerForm,
    retireWorkerForm,
    releaseWorkerForm,
    postTeamChatMessageForm,
  };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const form = await superValidate<AppSettingsForm>(
      await request.formData(),
      appSettingsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        ref: params.appId,
        name: form.data.name,
        urn: form.data.urn,
        appType: form.data.appType,
        role: form.data.role,
        description: form.data.description || null,
        systemPrompt: form.data.systemPrompt || null,
        createUserPermission: form.data.createUserPermission,
        identifyUserMethod: form.data.identifyUserMethod,
        sessionTimeoutSeconds: Number(form.data.sessionTimeoutSeconds),
        anonymousTtlDays: Number(form.data.anonymousTtlDays),
      });
      return message(form, { type: 'success', text: t('app.settings.saved', 'Saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update app') },
        { status: 500 },
      );
    }
  },

  addAgent: async ({ request, params, locals }) => {
    const form = await superValidate<AddAgentForm>(
      await request.formData(),
      addAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    // 008-agent-installation: addAgentToApp is now a setter on
    // App.agent_id; the legacy `role` arg is gone (system memory is
    // universally read-only from any App context). `trainingMode` is
    // forwarded only when the form submits it explicitly so the server
    // default applies otherwise.
    const variables: Record<string, unknown> = { appRef: params.appId, agentRef: form.data.agentId };
    if (typeof form.data.trainingMode === 'string') variables.trainingMode = form.data.trainingMode === 'true';
    try {
      await gqlClient(locals.token).request(ADD_AGENT_TO_APP_MUTATION, variables);
      return message(form, { type: 'success', text: t('app.agent.linked', 'Agent linked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to add agent') },
        { status: 500 },
      );
    }
  },

  removeAgent: async ({ request, params, locals }) => {
    const form = await superValidate<RemoveAppAgentForm>(
      await request.formData(),
      removeAppAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REMOVE_AGENT_FROM_APP_MUTATION, {
        appRef: params.appId,
        agentRef: form.data.agentId,
      });
      return message(form, { type: 'success', text: t('app.agent.unlinked', 'Agent unlinked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to remove agent') },
        { status: 500 },
      );
    }
  },

  updateAgentTools: async ({ request, params, locals }) => {
    const form = await superValidate<UpdateAppAgentToolsForm>(
      await request.formData(),
      updateAppAgentToolsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        ref: params.appId,
        agentTools: form.data.agentTools,
      });
      return message(form, { type: 'success', text: t('app.agent-tools.saved', 'Client tools saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update agent tools') },
        { status: 500 },
      );
    }
  },

  // ── Casting (#974) ──────────────────────────────────────────────────────
  //
  // castWorker CASTS an agent that is ALREADY INSTALLED in this App; it mints
  // nothing.
  //
  // #760: `name` is now REQUIRED — hadron-server#1050 removed the cast-list
  // register, so there is no "let the server choose" path left and the schema
  // rejects a blank one before we get here.
  //
  // `role` is still optional and still must be sent as UNDEFINED when blank:
  // an omitted role inherits the agent's personaRole, while '' would be an
  // explicit (and invalid) role — a different request entirely.
  castWorker: async ({ request, params, locals }) => {
    const form = await superValidate<CastWorkerForm>(
      await request.formData(),
      castWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CAST_WORKER_MUTATION, {
        appRef: params.appId,
        agentRef: form.data.agentId,
        // #760: sent as-is. The schema guarantees a non-empty name, so the
        // `|| undefined` coercion that used to mean "server, you choose" now
        // has nothing to express — and leaving it would quietly turn a
        // validation gap into a nameless cast the server refuses.
        name: form.data.name,
        role: form.data.role || undefined,
        promptOverride: form.data.promptOverride || undefined,
      });
      return message(form, {
        type: 'success',
        text: t('app.staff.cast.success', 'Worker cast.'),
      });
    } catch (e: unknown) {
      // Known refusals get copy that says what to do next; anything else —
      // including a transport failure with no GraphQL payload — falls through
      // to the server's own message rather than being relabelled as a user
      // mistake (review:clienterror-map-known-codes-only).
      const known = CAST_WORKER_ERRORS[gqlErrorCode(e) ?? ''];
      return message(
        form,
        {
          type: 'error',
          text: known ? known() : extractGqlError(e, t('app.staff.cast.error', 'Failed to cast the worker.')),
        },
        { status: 500 },
      );
    }
  },

  // Post to the App's TEAM CHAT (#732).
  //
  // Note what this action does NOT accept: no chat address. The server owns the
  // App's one well-known team chat and resolves it from `appRef`, which is why
  // a portal post cannot land in the wrong thread the way a loc-addressed write
  // could.
  //
  // No `sessionRef` either: a browser has no worker session, so the post is
  // attributed to the signed-in HUMAN. That is correct and deliberate — a
  // portal user posting as a worker would be forged attribution on the record
  // the team uses to answer "who did this".
  postTeamChatMessage: async ({ request, params, locals }) => {
    const form = await superValidate<PostTeamChatMessageForm>(
      await request.formData(),
      postTeamChatMessageFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    // An unparseable or non-positive replyToSeq is dropped rather than sent:
    // seq ascends from 1, so 0 or NaN could only ever be a client bug, and
    // sending it would turn a stray hidden input into TEAM_CHAT_REPLY_NOT_FOUND
    // on an ordinary post.
    const parsedReplyTo = Number(form.data.replyToSeq);
    const replyToSeq =
      form.data.replyToSeq && Number.isInteger(parsedReplyTo) && parsedReplyTo > 0
        ? parsedReplyTo
        : undefined;

    try {
      await gqlClient(locals.token).request(CREATE_TEAM_CHAT_MESSAGE_MUTATION, {
        appRef: params.appId,
        body: form.data.body,
        replyToSeq,
      });
      return message(form, {
        type: 'success',
        text: t('app.team-chat.post.success', 'Posted to the team chat.'),
      });
    } catch (e: unknown) {
      const known = TEAM_CHAT_POST_ERRORS[gqlErrorCode(e) ?? ''];
      return message(
        form,
        {
          type: 'error',
          text: known
            ? known()
            : extractGqlError(e, t('app.team-chat.post.error', 'Failed to post to the team chat.')),
        },
        { status: 500 },
      );
    }
  },

  // Retiring ends the casting but reserves the name FOREVER — it is not a
  // delete, and the row stays visible in the staff list.
  retireWorker: async ({ request, locals }) => {
    const form = await superValidate<RetireWorkerForm>(
      await request.formData(),
      retireWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(RETIRE_WORKER_MUTATION, {
        workerRef: form.data.workerId,
      });
      return message(form, {
        type: 'success',
        text: t('app.staff.retire.success', 'Worker retired. Its name stays reserved.'),
      });
    } catch (e: unknown) {
      // Same staffing gate as castWorker, so the same legible refusal.
      const forbidden = gqlErrorCode(e) === 'FORBIDDEN';
      return message(
        form,
        {
          type: 'error',
          text: forbidden
            ? STAFFING_FORBIDDEN()
            : extractGqlError(e, t('app.staff.retire.error', 'Failed to retire the worker.')),
        },
        { status: 500 },
      );
    }
  },

  // #756 / hadron-server#1050 — release a HELD name so somebody else can hold
  // it. Deliberately a SEPARATE action from retireWorker rather than a mode of
  // it: retiring ends the casting and keeps the name reserved forever, while
  // releasing leaves the worker active and touches neither its name allocation
  // nor its history. The issue asked to rename Retire to Release; these are two
  // operations that differ on whether the name ever becomes available again, so
  // the portal grew the missing one instead of relabelling the wrong one.
  releaseWorker: async ({ request, locals }) => {
    const form = await superValidate<ReleaseWorkerForm>(
      await request.formData(),
      releaseWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(RELEASE_WORKER_MUTATION, {
        workerRef: form.data.workerId,
      });
      return message(form, {
        type: 'success',
        text: t(
          'app.staff.release.success',
          'Name released. The worker stays active and keeps its name — anyone may hold it now.',
        ),
      });
    } catch (e: unknown) {
      // Same staffing gate as castWorker/retireWorker, so the same legible
      // refusal rather than a raw GraphQL error.
      const forbidden = gqlErrorCode(e) === 'FORBIDDEN';
      return message(
        form,
        {
          type: 'error',
          text: forbidden
            ? RELEASE_FORBIDDEN()
            : extractGqlError(e, t('app.staff.release.error', 'Failed to release the name.')),
        },
        { status: 500 },
      );
    }
  },

  createKey: async ({ request, params, locals }) => {
    const form = await superValidate<CreateAppKeyForm>(
      await request.formData(),
      createAppKeyFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const label = form.data.label || undefined;
    try {
      const result = await gqlClient(locals.token).request<{
        createAppKey: { key: { id: string }; rawKey: string };
      }>(CREATE_APP_KEY_MUTATION, { appRef: params.appId, label });
      return {
        form,
        rawKey: result.createAppKey.rawKey,
        keyId: result.createAppKey.key.id,
      };
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to create key') },
        { status: 500 },
      );
    }
  },

  revokeKey: async ({ request, locals }) => {
    const form = await superValidate<RevokeAppKeyForm>(
      await request.formData(),
      revokeAppKeyFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REVOKE_APP_KEY_MUTATION, { id: form.data.keyId });
      return message(form, { type: 'success', text: t('app.key.revoked', 'Key revoked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to revoke key') },
        { status: 500 },
      );
    }
  },

  deleteApp: async ({ request, params, locals }) => {
    const form = await superValidate<DeleteAppForm>(
      await request.formData(),
      deleteAppFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    // #648: where to land after delete depends on ownership — an org app returns
    // to its org apps grid, a user-owned (org-less) app to the personal "My apps"
    // list. Resolve the org BEFORE deleting (the row is gone afterwards); a
    // lookup failure falls back to the personal list.
    let orgId: string | null = null;
    try {
      const res = await client.request<{ app: { organizationId: string | null } | null }>(
        APP_ORG_QUERY,
        { ref: params.appId },
      );
      orgId = res.app?.organizationId ?? null;
    } catch {
      // Non-fatal — the redirect target degrades to the personal list.
    }

    try {
      await client.request(DELETE_APP_MUTATION, { ref: params.appId });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete app') },
        { status: 500 },
      );
    }
    redirect(303, orgId ? `/app/orgs/${orgId}/apps` : '/app/apps');
  },
};
