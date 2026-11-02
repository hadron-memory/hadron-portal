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

export interface IntegrationDraft {
  name: string;
  provider: 'github';
  repositories: string[];
  readyLabel: string;
  excludeLabels: string[];
  teams: TeamDraft[];
  /** Integration keys this form does not manage, written back as they were. */
  extra: Record<string, unknown>;
}

const MANAGED = new Set(['name', 'provider', 'repositories', 'readyLabel', 'excludeLabels', 'teams']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function readIntegrations(properties: unknown): IntegrationDraft[] {
  if (!isObject(properties) || !Array.isArray(properties.taskIntegrations)) return [];
  return properties.taskIntegrations.filter(isObject).map((raw) => ({
    name: typeof raw.name === 'string' ? raw.name : '',
    provider: 'github',
    repositories: strings(raw.repositories),
    readyLabel: typeof raw.readyLabel === 'string' ? raw.readyLabel : '',
    excludeLabels: strings(raw.excludeLabels),
    teams: (Array.isArray(raw.teams) ? raw.teams : []).filter(isObject).map((team) => ({
      lead: typeof team.lead === 'string' ? team.lead : null,
      label: typeof team.label === 'string' ? team.label : '',
    })),
    extra: Object.fromEntries(Object.entries(raw).filter(([k]) => !MANAGED.has(k))),
  }));
}

/** The properties to send: `current` with only `taskIntegrations` replaced. */
export function writeProperties(current: unknown, drafts: readonly IntegrationDraft[]): Record<string, unknown> {
  const base = isObject(current) ? current : {};
  const taskIntegrations = drafts.map((d) => ({
    ...d.extra,
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
 * JSON. Returns the drafts, or null when any element is not a well-formed integration (BLIND review of #1614, P2).
 */
export function parseDrafts(value: unknown): IntegrationDraft[] | null {
  if (!Array.isArray(value)) return null;
  const text = (v: unknown): v is string => typeof v === 'string';
  const list = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
  for (const d of value) {
    if (!isObject(d) || !text(d.name) || d.provider !== 'github' || !list(d.repositories) || !text(d.readyLabel) || !list(d.excludeLabels)) return null;
    if (!isObject(d.extra) || !Array.isArray(d.teams)) return null;
    if (!d.teams.every((team) => isObject(team) && (team.lead === null || text(team.lead)) && text(team.label))) return null;
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

export type LeadStatus =
  | { kind: 'live'; name: string; urn: string }
  | { kind: 'retired'; name: string | null; urn: string }
  | { kind: 'unknown' };

/** Whether a team's lead is a live worker of the App, from the roster read with retired castings included. */
export function leadStatus(
  lead: string | null,
  workers: readonly { id: string; name: string; urn?: string | null; retiredAt?: string | null }[],
): LeadStatus {
  if (lead === null) return { kind: 'unknown' };
  const w = workers.find((x) => x.urn === lead || x.id === lead);
  if (!w) return { kind: 'retired', name: null, urn: lead };
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
