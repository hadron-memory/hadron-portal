/**
 * portal#1650 — what the automation page shows of its team snapshot grant
 * (hadron-server#3350, hrn:node:hadronmemory.com:specs:cor:agt:050:23). `hidden`
 * is the server's refusal: only an App manager may read the list. `unavailable`
 * is a read that failed, and says nothing about the grant.
 */
export interface TeamGrantPerson { name: string; urn: string | null }

export interface TeamGrantRow {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  /** Null when the viewer may not read that person. */
  givenBy: TeamGrantPerson | null;
  endedBy: TeamGrantPerson | null;
}

export type TeamGrant =
  | { status: 'hidden' }
  | { status: 'unavailable' }
  /** `ended` is null until the manager asks for it. */
  | { status: 'ready'; live: TeamGrantRow | null; ended: TeamGrantRow[] | null };

const isPerson = (v: unknown): v is TeamGrantPerson | null => {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.name === 'string' && (p.urn === null || typeof p.urn === 'string');
};

const isRow = (v: unknown): v is TeamGrantRow => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.createdAt === 'string'
    && (r.revokedAt === null || typeof r.revokedAt === 'string')
    && isPerson(r.givenBy) && isPerson(r.endedBy);
};

/** What the section's re-read answered, or null when it isn't a grant at all: that is a failed read. */
export function parseTeamGrant(value: unknown): TeamGrant | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.status === 'hidden') return { status: 'hidden' };
  if (v.status === 'unavailable') return { status: 'unavailable' };
  if (v.status !== 'ready') return null;
  if (v.live !== null && !isRow(v.live)) return null;
  if (v.ended !== null && !(Array.isArray(v.ended) && v.ended.every(isRow))) return null;
  return { status: 'ready', live: v.live as TeamGrantRow | null, ended: v.ended as TeamGrantRow[] | null };
}
