/**
 * #942 slice 4 — an attendee's EFFECTIVE register, shown as facts that are
 * true about the ATTENDEE.
 *
 * `attendeeRegister` resolves one winning row per Channel: App over
 * organization, then Worker over Agent over everyone, never unioned (spec 049
 * §4.3). Its `canRead` / `canPost` / `disclosure` are computed for the CALLER
 * (hadron-server resolveRegister's actor is the request, not the attendee).
 * So they are NOT the attendee's access, and this view never presents them
 * that way. What it shows:
 * - which Channel, in which mode, counting which messages;
 * - WHY that row wins (their own row, their agent's, or everyone's) and who
 *   set it;
 * - how far the attendee has read (`lastSeenSeq` against the Channel's
 *   watermark `lastSeq`), as of the moment it was loaded;
 * - facts about the Channel itself (deleted), and about the VIEWER only when
 *   worded as the viewer's ("its memory isn't visible to you").
 */
import { t } from '$lib/i18n/t';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';

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

/** Why this row is the one that applies: the resolution's `namedBy`, plus who set it. */
export function becauseLabel(r: RegisterViewRow): string {
  const org = r.entry.ownerType === 'ORGANIZATION';
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

/** A fact about the Channel, or about the VIEWER worded as theirs; never the attendee's access. */
export function noteLabel(r: RegisterViewRow): string {
  if (r.channel.deleted) return t('app.channels.effective.note.deleted', 'Channel deleted');
  if (r.channel.hostMemoryUrn === null) return t('app.channels.effective.note.hidden', 'Its memory isn’t visible to you');
  return '';
}

export function effectiveRows(view: RegisterViewRow[]): EffectiveRow[] {
  return view.map((r) => ({
    id: r.entry.id,
    channel: r.channel.name,
    // Same-named Channels in different host memories are told apart by this.
    // The view row carries no chatRootUrn; its address is the host memory plus loc.
    channelUrn: r.channel.hostMemoryUrn ? composeNodeUrn(r.channel.hostMemoryUrn, r.channel.loc) : null,
    mode: modeLabel(r.entry.role),
    counts: r.entry.mentionOnly
      ? t('app.channels.register.mentions.only', 'Only when mentioned')
      : t('app.channels.register.mentions.all', 'All messages'),
    because: becauseLabel(r),
    readUpTo: readUpToLabel(r),
    note: noteLabel(r),
  }));
}
