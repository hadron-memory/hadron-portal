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
