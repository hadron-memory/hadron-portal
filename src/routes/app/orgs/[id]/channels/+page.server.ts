import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { fetchAllItems } from '$lib/server/paginate';
import { mapWithConcurrency } from '$lib/server/concurrency';
import { attendanceActions, registerForms } from '$lib/server/register-actions';
import {
  APP_INSTALLED_AGENTS_QUERY,
  ORG_APPS_FOR_REGISTER_QUERY,
  ORG_CHANNELS_QUERY,
  ORG_MEMBER_ROLES_QUERY,
  REGISTER_ENTRIES_BY_OWNER_QUERY,
  WORKERS_QUERY,
} from '$lib/server/queries';
import type { Attendee } from '$lib/register/types';
import type { Channel, RegisterEntry } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { readableInstalledAgents, type InstalledAgent } from '$lib/app-installed-agents';

/**
 * #942 — an organization's Channels and its OWN register rows (org-owned
 * attendance, spec 049). The App Channels page shows these rows read-only as
 * inherited; this is where they are managed.
 *
 * Server contract, on hadron-server main (lib/register.ts):
 * - writing an org row needs org CONTRIBUTOR+;
 * - a row may name a Channel the caller can read, or one hosted in one of the
 *   org's memories;
 * - its attendee is a Worker cast in any of the org's Apps, or an Agent
 *   installed in one.
 * This page only decides what to OFFER. Every write runs under the caller's
 * token, and a refusal comes back in the server's words.
 *
 * Everything here is a read. Nothing marks a Channel read or posts: settings
 * are not a way to move anyone's cursor.
 */

type OrgApp = { id: string; name: string; urn: string };
type OrgWorker = { id: string; name: string; urn: string | null; role: string | null; retiredAt: string | null };

/**
 * The caller's org role, as far as this page can see it: members only list for
 * members. A non-member who can still open the org (a platform admin) reads
 * as `null`, which is unknown: the controls are offered and the server decides.
 */
function canManageFromRole(role: string | null | undefined): boolean | null {
  if (role === 'CONTRIBUTOR' || role === 'ADMIN' || role === 'OWNER') return true;
  if (role === 'READER') return false;
  return null;
}

/** How many Apps' rosters are read at once. The fan-out scales with the org. */
const ROSTER_CONCURRENCY = 4;

/**
 * Who an org row can name: every Worker cast in any of the org's Apps
 * (retired included, so old rows keep their names) and every Agent installed
 * in one, each listed once. A Worker name is unique only within its App, so
 * the App is part of its label here.
 *
 * Two requests per App, so they run with bounded concurrency rather than as one
 * burst (Codex on #955). An App whose roster can't be read is COUNTED, not
 * fatal: the register rows still show (they carry their own attendee URNs),
 * and the page says how many Apps' people are missing from the picker.
 */
async function loadOrgAttendees(
  client: ReturnType<typeof gqlClient>,
  orgId: string,
): Promise<{ attendees: Attendee[]; unreadApps: number }> {
  const apps = await fetchAllItems<OrgApp>(client, ORG_APPS_FOR_REGISTER_QUERY, 'apps', { orgId });
  const perApp = await mapWithConcurrency(apps, ROSTER_CONCURRENCY, async (app) => {
    // allSettled, not all: an App's slot must stay taken until BOTH of its
    // reads have finished. With Promise.all a fast rejection would free the
    // slot while its sibling was still running, and a run of such failures
    // would rebuild the unbounded burst this bound exists to prevent (Codex).
    const [workers, installed] = await Promise.allSettled([
      fetchAllItems<OrgWorker>(client, WORKERS_QUERY, 'workers', { appRef: app.id, includeRetired: true }),
      client.request<{ app: { appAgents: Array<{ agent: InstalledAgent | null }> } | null }>(
        APP_INSTALLED_AGENTS_QUERY,
        { ref: app.id },
      ),
    ]);
    if (workers.status === 'rejected' || installed.status === 'rejected') {
      console.warn(`[org-channels] roster read failed for app ${app.id}:`, workers.status === 'rejected' ? workers.reason : (installed as PromiseRejectedResult).reason);
      return { app, workers: [] as OrgWorker[], agents: [] as Array<{ id: string; name: string; urn: string }>, failed: true };
    }
    return { app, workers: workers.value, agents: readableInstalledAgents(installed.value.app?.appAgents), failed: false };
  });
  // An App's display name alone can repeat within an org; when it does, its URN
  // joins the label so the options stay distinct. The App URN is also kept on
  // the attendee, and the picker shows it for the chosen Worker (Codex on #955).
  const nameCount = new Map<string, number>();
  for (const { name } of apps) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  const appLabel = (app: OrgApp) => ((nameCount.get(app.name) ?? 0) > 1 ? `${app.name} · ${app.urn}` : app.name);
  const workers: Attendee[] = perApp.flatMap(({ app, workers }) =>
    workers.map((w) => ({
      id: w.id,
      name: `${w.name} (${appLabel(app)})`,
      urn: w.urn,
      kind: 'worker' as const,
      role: w.role,
      retired: !!w.retiredAt,
      appUrn: app.urn,
    })),
  );
  const agents = new Map<string, Attendee>();
  for (const { agents: installed } of perApp) {
    for (const a of installed) if (!agents.has(a.id)) agents.set(a.id, { id: a.id, name: a.name, urn: a.urn, kind: 'agent' });
  }
  return { attendees: [...workers, ...agents.values()], unreadApps: perApp.filter((r) => r.failed).length };
}

export const load: PageServerLoad = async ({ parent, locals }) => {
  // An admin surface like the sibling Team / Integrations / Usage tabs: hiding
  // the tab in consumer mode is not the only restriction (Codex on #955).
  await requireNonConsumer(parent);
  const { org } = await parent();
  const client = gqlClient(locals.token);

  const [channels, register, role] = await Promise.all([
    // The org's Channels. A failure here is the page's failure: the register
    // below names them.
    fetchAllItems<Channel>(client, ORG_CHANNELS_QUERY, 'channels', { orgId: org.id }),
    // The register is reported as failed, never shown as empty: "no rows" and
    // "couldn't read the rows" are different facts.
    // The rows and the roster are read SEPARATELY: the rows carry their own
    // attendee URNs and render without the roster, so a roster outage (even
    // listing the org's Apps) must not hide them (Codex on #955).
    Promise.all([
      fetchAllItems<RegisterEntry>(client, REGISTER_ENTRIES_BY_OWNER_QUERY, 'registerEntries', { ownerRef: org.id })
        .then((rows) => ({ rows, failed: false }))
        .catch((e) => {
          console.warn(`[org-channels] register read failed for org ${org.id}:`, e);
          return { rows: [] as RegisterEntry[], failed: true };
        }),
      loadOrgAttendees(client, org.id)
        .then((roster) => ({ ...roster, rosterFailed: false }))
        .catch((e) => {
          console.warn(`[org-channels] App list read failed for org ${org.id}:`, e);
          return { attendees: [] as Attendee[], unreadApps: 0, rosterFailed: true };
        }),
    ]).then(([rows, roster]) => ({ ...rows, ...roster })),
    locals.user
      ? client
          .request<{ organization: { members: Array<{ role: string; user: { id: string } }> } | null }>(ORG_MEMBER_ROLES_QUERY, { ref: org.id })
          .then((r) => r.organization?.members.find((m) => m.user.id === locals.user!.id)?.role ?? null)
          .catch((e) => {
            console.warn(`[org-channels] member-role read failed for org ${org.id}:`, e);
            return null;
          })
      : Promise.resolve(null),
  ]);

  return {
    channels,
    orgRows: register.rows.filter((r) => r.ownerType === 'ORGANIZATION'),
    attendees: register.attendees,
    /** Apps whose Workers and Agents couldn't be read, so aren't offered. */
    rosterUnreadApps: register.unreadApps,
    /** The org's App list itself couldn't be read: nobody is offered by name. */
    rosterFailed: register.rosterFailed,
    registerLoadFailed: register.failed,
    canManageRegister: canManageFromRole(role),
    ...(await registerForms()),
  };
};

export const actions: Actions = {
  // Org-owned rows: the owner is this page's organization, never a form field.
  ...attendanceActions((params) => params.id),
};
