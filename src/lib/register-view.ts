/**
 * #942 slice 4 — an attendee's EFFECTIVE register, shown as facts that are
 * true about the ATTENDEE.
 *
 * `attendeeRegister` resolves one winning row per Channel: App over
 * organization, then Worker over Agent over everyone, never unioned (spec 049
 * §4.3). Since server #1560, `canRead` / `canPost` / `disclosure` are
 * computed for the ATTENDEE (a Worker's eligible holder or an Agent's App
 * principal). Viewer access separately gates `hostMemoryUrn`: standing is
 * worded only when that host memory is visible. A register entry grants no
 * access; the server's host-memory gates decide the standing.
 * The winning row, its provenance and the attendee's read watermark remain
 * independent facts; lastSeq is a watermark, never an unread count.
 */
import { t } from '$lib/i18n/t';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { countsAsNewLabel } from '$lib/register-counts';

export interface RegisterViewRow {
  namedBy: 'WORKER' | 'AGENT' | 'EVERYONE';
  lastSeenSeq: number | null;
  canRead: boolean;
  canPost: boolean | null;
  disclosure: string | null;
  attendeeUrn: string | null;
  entry: { id: string; ownerType: 'ORGANIZATION' | 'APP'; role: 'WATCH' | 'POST' | 'BOTH'; mentionOnly: boolean; installDefault: boolean };
  channel: { id: string; name: string; loc: string; hostMemoryUrn: string | null; lastSeq: number; lastMessageAt: string | null; deleted: boolean };
}

export interface EffectiveRow {
  id: string;
  channel: string;
  /** The Channel's address, or null when its host memory isn't visible to the viewer: no chip then. */
  channelUrn: string | null;
  mode: string;
  counts: string;
  because: string;
  readUpTo: string;
  note: string;
}

export function modeLabel(role: RegisterViewRow['entry']['role']): string {
  switch (role) {
    case 'WATCH':
      return t('app.channels.register.role.watch', 'Watch');
    case 'POST':
      return t('app.channels.register.role.post', 'Post');
    default:
      return t('app.channels.register.role.both', 'Watch and post');
  }
}

/** Whose effective register this is: an Agent's own row and a Worker's agent's row read differently. */
export type AttendeeKind = 'worker' | 'agent';

/**
 * Why this row is the one that applies: the resolution's `namedBy`, plus who
 * set it. `namedBy: AGENT` is the Worker's AGENT's row when a Worker is
 * shown, but the attendee's OWN row when the attendee is that Agent.
 */
export function becauseLabel(r: RegisterViewRow, kind: AttendeeKind = 'worker'): string {
  const org = r.entry.ownerType === 'ORGANIZATION';
  const own = r.namedBy === 'WORKER' || (r.namedBy === 'AGENT' && kind === 'agent');
  if (own) {
    return org
      ? t('app.channels.effective.because.worker-org', 'Their own row, set by the organization')
      : t('app.channels.effective.because.worker', 'Their own row');
  }
  switch (r.namedBy) {
    case 'WORKER':
      return org
        ? t('app.channels.effective.because.worker-org', 'Their own row, set by the organization')
        : t('app.channels.effective.because.worker', 'Their own row');
    case 'AGENT':
      return org
        ? t('app.channels.effective.because.agent-org', 'Their agent’s row, set by the organization')
        : t('app.channels.effective.because.agent', 'Their agent’s row');
    default:
      return org
        ? t('app.channels.effective.because.everyone-org', 'Everyone in the organization')
        : t('app.channels.effective.because.everyone', 'Everyone in this App');
  }
}

/**
 * How far the attendee has read, stated without claiming more than the data
 * says. `lastSeq` is a watermark, not a count, and a mention-only row counts
 * only some messages as new, so this says "read up to #n of #m", never
 * "k unread".
 */
export function readUpToLabel(r: RegisterViewRow): string {
  const last = r.channel.lastSeq;
  if (last === 0) return t('app.channels.effective.read.empty', 'No messages yet');
  if (r.lastSeenSeq === null) return t('app.channels.effective.read.untracked', 'Not tracked');
  if (r.lastSeenSeq >= last) return t('app.channels.effective.read.current', 'Up to date (#{seq})', { seq: String(last) });
  return t('app.channels.effective.read.partial', 'Read up to #{seen} of #{last}', { seen: String(r.lastSeenSeq), last: String(last) });
}

/** Viewer masking comes before attendee standing; deleted channels keep their existing note. */
export function noteLabel(r: RegisterViewRow): string {
  if (r.channel.deleted) return t('app.channels.effective.note.deleted', 'Channel deleted');
  if (r.channel.hostMemoryUrn === null) return t('app.channels.effective.note.hidden', 'Its memory isn’t visible to you');
  switch (r.disclosure) {
    case 'HOST_MEMORY_NOT_READABLE':
      return t('app.channels.effective.note.unreadable', 'They cannot read its host memory');
    case 'HOST_MEMORY_NOT_WRITABLE':
      return t('app.channels.effective.note.unwritable', 'They cannot write its host memory (watch only)');
    case 'CHANNEL_DELETED':
      return t('app.channels.effective.note.deleted', 'Channel deleted');
    case 'DRIVER_NOT_PARTICIPANT':
      return t('app.channels.effective.note.driver', 'Their driver is not a participant of the host App (watch only)');
    case 'UNKNOWN_ACTOR':
      return t('app.channels.effective.note.unknown-actor', 'Their posting rights cannot be evaluated (no eligible driver)');
    case 'IMPERSONATION':
      return t('app.channels.effective.note.impersonation', 'Their support view is read only');
    case null:
      return r.canRead && r.canPost === true
        ? t('app.channels.effective.note.allowed', 'They can read and post')
        : '';
    default:
      // A new server reason needs deliberate wording, never an access inference.
      return '';
  }
}

export function effectiveRows(view: RegisterViewRow[], kind: AttendeeKind = 'worker'): EffectiveRow[] {
  return view.map((r) => ({
    id: r.entry.id,
    channel: r.channel.name,
    // Same-named Channels in different host memories are told apart by this.
    // The view row carries no chatRootUrn; its address is the host memory plus loc.
    channelUrn: r.channel.hostMemoryUrn ? composeNodeUrn(r.channel.hostMemoryUrn, r.channel.loc) : null,
    mode: modeLabel(r.entry.role),
    counts: countsAsNewLabel(r.entry.role, r.entry.mentionOnly),
    because: becauseLabel(r, kind),
    readUpTo: readUpToLabel(r),
    note: noteLabel(r),
  }));
}
