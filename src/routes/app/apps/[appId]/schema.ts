import { t } from '$lib/i18n/t';
import { z } from 'zod';

const agentToolsField = z.preprocess(
  (value) => value === undefined ? [] : (Array.isArray(value) ? value : [value]),
  z.array(z.string().trim().min(1)),
);

export const appSettingsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateApp').default('updateApp'),
  name: z.string().trim().min(1, 'Name is required').prefault(''),
  urn: z.string().trim().min(1, 'URN slug is required').prefault(''),
  appType: z.enum(['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT']).prefault('WORKSTATION'),
  role: z.enum(['OWNER', 'ADMIN', 'CONTRIBUTOR', 'READER']).prefault('READER'),
  description: z.string().trim().default(''),
  createUserPermission: z.enum(['DENY', 'EXPLICIT', 'IMPLICIT']).prefault('DENY'),
  identifyUserMethod: z.enum(['USER_ID', 'SECRET']).prefault('USER_ID'),
  sessionTimeoutSeconds: z.string()
    .trim()
    .regex(/^\d+$/, 'Session timeout must be a whole number')
    .refine((value) => Number(value) >= 60, 'Session timeout must be at least 60 seconds')
    .refine((value) => Number(value) <= 86400, 'Session timeout must be at most 86400 seconds')
    .prefault(''),
  anonymousTtlDays: z.string()
    .trim()
    .regex(/^\d+$/, 'Anonymous TTL must be a whole number')
    .refine((value) => Number(value) >= 1, 'Anonymous TTL must be at least 1 day')
    .refine((value) => Number(value) <= 90, 'Anonymous TTL must be at most 90 days')
    .prefault(''),
});

export const addAgentSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addAgent').default('addAgent'),
  agentId: z.string().trim().min(1, 'Agent is required').prefault(''),
  trainingMode: z.enum(['true', 'false']).optional(),
});

export const createAppKeySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('createKey').default('createKey'),
  label: z.string().trim().default(''),
});

export const removeAppAgentSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('removeAgent').default('removeAgent'),
  agentId: z.string().trim().min(1, 'Agent is required').prefault(''),
});

export const updateAppAgentToolsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateAgentTools').default('updateAgentTools'),
  agentTools: agentToolsField.prefault([]),
});

export const revokeAppKeySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('revokeKey').default('revokeKey'),
  keyId: z.string().trim().min(1, 'Key is required').prefault(''),
});

export const deleteAppSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteApp').default('deleteApp'),
});

// ── Casting (#974, #760) ──────────────────────────────────────────────────
//
// Casting an INSTALLED agent into this App under a name creates a Worker: the
// App's staff.
//
// `name` is REQUIRED (#760). It was optional until hadron-server#1050 removed
// the cast-list register: an omitted name used to walk the Team Agent's
// register for the next free one, and the server now refuses a nameless cast
// with WORKER_NAME_REQUIRED. Leaving it optional here does not make the cast
// work — it makes the form recommend a request the server rejects, which is
// exactly what #760 reports.
//
// R222: the selected Agent determines the role; casting cannot override it.
export const castWorkerSchema = z.object({
  _kind: z.literal('castWorker').default('castWorker'),
  agentId: z.string().trim().min(1, 'Select an agent to cast.').prefault(''),
  name: z.string().trim().min(1, 'Give the worker a name — the platform no longer picks one.').prefault(''),
  // hadron-portal#1149 (hadron-server#2028, S12) — the cast takes a DELIBERATE
  // reporting choice: a head, or an explicit No team. Nothing is preselected,
  // and a missing choice is refused here rather than sent: omission is never
  // No team, and the coordinator is never guessed. `reporting` has no default
  // for that reason; a blank or unknown value fails the enum.
  //
  // The WIRE is presence-based (the action sends exactly one of `reportsTo` /
  // `noTeam: true` and omits the other), so this form carries the choice as a
  // two-way switch plus a head, and the action turns it into one arm.
  //
  // The empty string is the form's "nothing chosen yet" state, NOT a third
  // choice: Superforms seeds an enum field with its FIRST member, which would
  // preselect "a head" on a form that must start with neither. The refine
  // below refuses it.
  reporting: z.enum(['', 'head', 'none']).prefault(''),
  reportsTo: z.string().trim().default(''),
}).superRefine((value, ctx) => {
  if (value.reporting === '') {
    ctx.addIssue({ code: 'custom', path: ['reporting'], message: 'Choose who this worker reports to, or choose No team.' });
  }
  if (value.reporting === 'head' && !value.reportsTo) {
    ctx.addIssue({ code: 'custom', path: ['reportsTo'], message: 'Choose the worker this one reports to, or choose No team.' });
  }
});

export const retireWorkerSchema = z.object({
  _kind: z.literal('retireWorker').default('retireWorker'),
  workerId: z.string().trim().min(1, 'Worker is required').prefault(''),
});

// #756 / hadron-server#1050 — releasing a HELD name is a DIFFERENT act from
// retiring, so it gets its own schema and action rather than a flag on the one
// above. Retiring ends the casting and reserves the name forever; releasing
// frees the person's hold and leaves the worker active. Sharing a form between
// them is how the two would start being described as one thing.
export const releaseWorkerSchema = z.object({
  _kind: z.literal('releaseWorker').default('releaseWorker'),
  workerId: z.string().trim().min(1, 'Worker is required').prefault(''),
  // #825 — the hold this click was aimed at, asserted on the write.
  //
  // REQUIRED, which is the fix rather than a detail of it. The roster is a
  // snapshot and this page does not poll, so an unguarded release acts on
  // whoever holds the name at the moment the click LANDS — and the admin path
  // announces that person in the team chat by name
  // (`hrn:node:hadronmemory.com:specs:cor:agt:020:09`). An admin who agreed to
  // force-release one colleague could publicly release a different one.
  //
  // Making it required means an unguarded release is not expressible through
  // this form at all. A missing value is a client bug and fails loudly here,
  // rather than degrading to the unconditional write that was the defect. The
  // control only renders for a KNOWN hold, so there is always an id to send.
  expectedHolderUserId: z.string().trim().min(1, 'Expected holder is required').prefault(''),
});

// #823 — `releaseWorker` has THREE outcomes and the click has one intent, so
// the action reports which one the server described rather than asserting the
// one that was asked for:
//
//   released            — `releasedFrom` non-null, no notice owed or one posted
//   announcement-failed — released, and `notified: false`: the team-chat notice
//                         `hrn:node:hadronmemory.com:specs:cor:agt:020:09`
//                         requires was OWED AND FAILED
//   not-held            — `releasedFrom` null: the mutation is idempotent on an
//                         unheld worker, so nothing was released
//
// Carried as a field on THIS form's message rather than as a third member of
// `App.Superforms.Message['type']`. That union has ~130 readers across the app
// written as `=== 'success'` / `!== 'error'`, and widening it would recruit
// every one of them silently
// (`hrn:node:hadronmemory.com:hadron-portal:review:widening-a-union-recruits-every-fallback`).
// Here the page maps the outcome through an exhaustive `Record`, so adding a
// fourth member is a compile error rather than a green fallback.
export type ReleaseOutcome = 'released' | 'announcement-failed' | 'not-held';

// `outcome` is absent on the error path, which is unchanged: an error message
// describes a release that did not happen at all.
//
// #825 adds `staleHold`, deliberately ORTHOGONAL to both `type` and `outcome`
// rather than a fourth outcome. It answers one question — "is the roster this
// click came from now known to be wrong?" — and the answer is yes on paths that
// are otherwise an error (someone else holds it now) AND on one that is a
// success (nobody holds it, so the user's intent already stands). Folding it
// into `ReleaseOutcome` would put a member into the chrome `Record` that can
// never render, since the notice only reads successes.
export type ReleaseWorkerMessage = App.Superforms.Message & {
  outcome?: ReleaseOutcome;
  staleHold?: true;
};

// Posting to the App's TEAM CHAT (hadron-portal#732) is defined in $lib/forms
// so the route action and TeamChatThread.svelte share one definition.
export { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';

// #1005: the Human Team tab (the former /members page) posts to this page.

export const addAppMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addAppMember').default('addAppMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
  role: z.string().trim().min(1, 'Role is required.').prefault(''),
});

export const ensureAppMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('ensureAppMember').default('ensureAppMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
  role: z.string().trim().min(1, 'Role is required.').prefault(''),
});

export const removeAppMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('removeAppMember').default('removeAppMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
});


// #1023's deleteWorkerSchema moved to $lib/workers/delete-worker.ts (portal#2205):
// the worker's own page runs the same delete through the same contract, so the
// schema lives beside the attestation token neither route owns alone.

// #487: only a NEW memory, born on this App. No caller-controlled App,
// Agent, class, or existing-memory reference is part of this form.
export const createAppMemorySchema = z.object({
  _kind: z.literal('createAppMemory').default('createAppMemory'),
  name: z.string().trim().min(1, t('app.memory.name-required', 'Give the memory a name.')).prefault(''),
  description: z.string().trim().prefault(''),
});
