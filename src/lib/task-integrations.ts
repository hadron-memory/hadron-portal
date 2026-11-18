/**
 * portal#1607 — an App's task integrations (hrn:node:hadronmemory.com:specs:cor:agt:120:01) as the settings form
 * sees them. They live under the `taskIntegrations` key of `App.properties`,
 * which `setAppProperties` replaces WHOLE (hrn:node:hadronmemory.com:specs:cor:dmo:050:20, V34): the write is
 * therefore the current object with only that key changed.
 *
 * Pure: no I/O, no Svelte. The server-side read and write are
 * `$lib/server/app-properties`.
 */
import { t } from '$lib/i18n/t';

export const MAX_REPOSITORIES = 50;
/** `owner/name`, the shape the server accepts. */
export const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export interface TeamDraft {
  /** The lead worker's URN as the read projection returns it; null when the worker row is gone. */
  lead: string | null;
  label: string;
}

/**
 * The providers this portal can edit. WIRING ONLY (portal#1679 Decision 4): the type, the read, `blankIntegration()`,
 * the provider picker and the posted-draft gate all derive from it, but it never admits a provider by itself. Only
 * the server's SDL and closed set (hadron-server `TASK_INTEGRATION_PROVIDERS`) do. A provider the server knows and
 * this list lacks is "unsupported" here: a limit of this client, not a refusal.
 */
export const TASK_INTEGRATION_PROVIDERS = ['github'] as const;
export type TaskIntegrationProvider = (typeof TASK_INTEGRATION_PROVIDERS)[number];
const isProvider = (v: unknown): v is TaskIntegrationProvider => typeof v === 'string' && (TASK_INTEGRATION_PROVIDERS as readonly string[]).includes(v);

export interface IntegrationDraft {
  name: string;
  provider: TaskIntegrationProvider;
  repositories: string[];
  readyLabel: string;
  excludeLabels: string[];
  teams: TeamDraft[];
}

/**
 * A stored entry this portal can't represent (unknown provider, unknown key, wrong-typed or non-object). It is shown,
 * never coerced, dropped or written back: the server's closed set would refuse a raw round trip, so "preserved" would
 * be false. It blocks editing until the person removes it on purpose.
 */
export interface UnsupportedEntry {
  unsupported: true;
  /** Position in the stored list (0-based). */
  index: number;
  /** The stored provider when it is a string, else null. Text only. */
  provider: string | null;
}
export type IntegrationEntry = IntegrationDraft | UnsupportedEntry;
export const isUnsupported = (e: IntegrationEntry): e is UnsupportedEntry => 'unsupported' in e;

const MANAGED = ['name', 'provider', 'repositories', 'readyLabel', 'excludeLabels', 'teams'] as const;
const TEAM_KEYS = ['lead', 'label'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));
const isTeam = (v: unknown): v is { lead: string | null; label: string } =>
  isObject(v) && onlyKeys(v, TEAM_KEYS) && (v.lead === null || text(v.lead)) && text(v.label);

export const blankIntegration = (): IntegrationDraft => ({
  name: '', provider: TASK_INTEGRATION_PROVIDERS[0], repositories: [''], readyLabel: '', excludeLabels: [], teams: [],
});

/**
 * Every stored entry, in order. One this portal can fully represent is a draft; anything else is an UnsupportedEntry,
 * so the count is preserved and nothing is silently dropped or rewritten as something else.
 */
export function readIntegrations(properties: unknown): IntegrationEntry[] {
  if (!isObject(properties) || !Array.isArray(properties.taskIntegrations)) return [];
  return properties.taskIntegrations.map((raw, index): IntegrationEntry => {
    const unsupported: UnsupportedEntry = { unsupported: true, index, provider: isObject(raw) && text(raw.provider) ? raw.provider : null };
    if (!isObject(raw) || !onlyKeys(raw, MANAGED) || !isProvider(raw.provider) || !text(raw.name)) return unsupported;
    if (!stringList(raw.repositories)) return unsupported;
    if (raw.readyLabel !== undefined && !text(raw.readyLabel)) return unsupported;
    if (raw.excludeLabels !== undefined && !stringList(raw.excludeLabels)) return unsupported;
    if (raw.teams !== undefined && !(Array.isArray(raw.teams) && raw.teams.every(isTeam))) return unsupported;
    return {
      name: raw.name,
      provider: raw.provider,
      repositories: raw.repositories,
      readyLabel: raw.readyLabel ?? '',
      excludeLabels: raw.excludeLabels ?? [],
      teams: (raw.teams ?? []).map((team) => ({ lead: (team as { lead: string | null }).lead, label: (team as { label: string }).label })),
    };
  });
}

/** The properties to send: `current` with only `taskIntegrations` replaced. */
export function writeProperties(current: unknown, drafts: readonly IntegrationDraft[]): Record<string, unknown> {
  const base = isObject(current) ? current : {};
  const taskIntegrations = drafts.map((d) => ({
    name: d.name.trim(),
    provider: d.provider,
    repositories: d.repositories.map((r) => r.trim()),
    ...(d.readyLabel.trim() ? { readyLabel: d.readyLabel.trim() } : {}),
    ...(d.excludeLabels.length ? { excludeLabels: d.excludeLabels.map((l) => l.trim()) } : {}),
    ...(d.teams.length ? { teams: d.teams.map((team) => ({ lead: team.lead, label: team.label.trim() })) } : {}),
  }));
  return { ...base, taskIntegrations };
}

/**
 * The posted drafts, checked for SHAPE before anything dereferences them: a crafted POST can carry any
 * JSON. Returns the drafts, or null when any element is not a well-formed integration: a key outside the managed set
 * (the old `extra` included), a provider outside the constant, or a wrong-typed field (BLIND review of #1614, P2;
 * portal#1679 U7). An unsupported entry is never a draft.
 */
export function parseDrafts(value: unknown): IntegrationDraft[] | null {
  if (!Array.isArray(value)) return null;
  for (const d of value) {
    if (!isObject(d) || !onlyKeys(d, MANAGED) || !text(d.name) || !isProvider(d.provider) || !stringList(d.repositories) || !text(d.readyLabel) || !stringList(d.excludeLabels)) return null;
    if (!Array.isArray(d.teams) || !d.teams.every(isTeam)) return null;
  }
  return value as IntegrationDraft[];
}

/** Browser-side checks, keyed by the JSON path the server's TASK_INTEGRATION_INVALID names. */
export function validateDrafts(drafts: readonly IntegrationDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  drafts.forEach((d, i) => {
    const at = `taskIntegrations[${i}]`;
    if (!d.name.trim()) errors[`${at}.name`] = t('app.integrations.error.name', 'Enter a name.');
    if (d.repositories.length < 1) errors[`${at}.repositories`] = t('app.integrations.error.repositories-min', 'Add at least one repository.');
    if (d.repositories.length > MAX_REPOSITORIES) errors[`${at}.repositories`] = t('app.integrations.error.repositories-max', 'At most {max} repositories.', { max: MAX_REPOSITORIES });
    d.repositories.forEach((r, j) => {
      if (!REPOSITORY_PATTERN.test(r.trim())) errors[`${at}.repositories[${j}]`] = t('app.integrations.error.repository', 'Use the form owner/name.');
    });
    d.teams.forEach((team, j) => {
      if (team.lead === null) errors[`${at}.teams[${j}].lead`] = t('app.integrations.error.lead-unknown', 'Pick a lead, or remove this team.');
      if (!team.label.trim()) errors[`${at}.teams[${j}].label`] = t('app.integrations.error.team-label', 'Enter a label.');
    });
  });
  return errors;
}

export interface LeadWorker {
  id: string;
  name: string;
  urn?: string | null;
  retiredAt?: string | null;
}

export type LeadStatus =
  | { kind: 'live'; name: string; urn: string }
  | { kind: 'retired'; name: string; urn: string }
  | { kind: 'missing'; urn: string }
  | { kind: 'unchecked'; urn: string }
  | { kind: 'unknown' };

/**
 * Whether a team's lead is a live worker of the App, from the roster read with retired castings
 * included, so a retired worker is always in it. Absent from that roster isn't retirement, and
 * with no roster (`null`, a failed read) nothing is known about the lead at all.
 */
export function leadStatus(
  lead: string | null,
  workers: readonly LeadWorker[] | null | undefined,
): LeadStatus {
  if (lead === null) return { kind: 'unknown' };
  if (workers == null) return { kind: 'unchecked', urn: lead };
  const w = workers.find((x) => x.urn === lead || x.id === lead);
  if (!w) return { kind: 'missing', urn: lead };
  return w.retiredAt ? { kind: 'retired', name: w.name, urn: lead } : { kind: 'live', name: w.name, urn: lead };
}

/** What the save action answers: the new revision, or one refusal. */
export type TaskIntegrationsResult =
  | { ok: true; revision: number | null }
  | { ok: false; code: string | null; message: string; path: string | null; currentRevision: number | null };

export const TASK_INTEGRATION_REFUSALS = [
  'TASK_INTEGRATION_INVALID',
  'APP_PROPERTIES_CONFLICT',
  'PROPERTIES_NOT_AN_OBJECT',
  'PROPERTIES_TOO_LARGE',
  'PROPERTIES_KEY_RESERVED',
] as const;
