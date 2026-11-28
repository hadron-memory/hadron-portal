import { t } from '$lib/i18n/t';
import { extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';

/** Only these fixed messages may cross the chat API boundary. Never retain a raw cause. */
export const CHAT_ERROR = {
  noConfig: t('agent-chat.error.no-config', 'Agent has no LLM provider configured. Set one in agent settings first.'),
  oldServer: t('agent-chat.error.old-server', "The Hadron server didn't recognize effectiveEndpoint, which portal chats need to check where an AI configuration sends requests, so the chat won't run. The server may be older than this portal."),
  credentialUnavailable: t('agent-chat.error.credential-unavailable', 'The credentials for this AI configuration are not available to this portal session. Ask whoever manages the configuration for access, or use an available configuration.'),
  configUnsupported: t('agent-chat.error.config-unsupported', 'This AI configuration cannot run in portal chats. Check its provider and endpoint.'),
  // portal#1963 (hadron-server#3957): the server refused the chat's AI config choice (another App's, deleted, or
  // unknown: one answer for all three). Fixed copy only; the id is never echoed.
  configChoiceUnavailable: t('agent-chat.error.config-choice-unavailable', "That AI config isn't available for this chat any more. Pick another one and send again."),
  llmFailed: t('agent-chat.error.llm-failed', 'The AI turn could not be completed. Check the provider configuration and try again.'),
  fixtureEndedWelcome: t('agent-chat.error.fixture-ended-welcome', 'Chat ended during the welcome turn before the fixture message was sent.'),
  // portal#1665 — the server's closed set of boot-prompt refusals (hrn:node:hadronmemory.com:specs:cor:agt:040:10). One fixed message each.
  // None says which level (Agent, App or worker) decides, and none promises that approving the Agent's own
  // prompt fixes it: the deciding pointer may be the App's. A retry can work once someone legitimately sets up
  // or approves a prompt, so the copy says "until they do", never "can never run".
  bootPromptNotSet: t('agent-chat.error.boot-prompt-not-set', "This Agent has no boot prompt set up, so the chat can't run. Whoever manages the Agent or this App has to set one up. Trying again won't help until they do."),
  bootPromptTargetDeleted: t('agent-chat.error.boot-prompt-target-deleted', "This Agent's boot prompt was removed, so the chat can't run until whoever manages it sets a new one. Trying again won't help until they do."),
  bootPromptNotApproved: t('agent-chat.error.boot-prompt-not-approved', "No approved version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it approves one. Trying again won't help until they do."),
  // Defensive until hadron-server#1614: nothing can return it while signing is not required.
  bootPromptNotSigned: t('agent-chat.error.boot-prompt-not-signed', "No signed version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it signs one. Trying again won't help until they do."),
  // Defensive: a bind or a run raises it; the chat path excludes it (server serve.ts).
  bootPromptRecordedRevisionDeleted: t('agent-chat.error.boot-prompt-recorded-revision-deleted', "The boot prompt version this conversation was given has been deleted, so it can't continue. Start a new chat."),
  // portal#1786 (hadron-server#3626): a personal App's owner stopped qualifying for its ORGANIZATION-visible Agent.
  // No route back is promised: rejoining doesn't help if the Agent's visibility narrowed, and none is known
  // from a revoked subscription. Nor does it imply that a reload helps.
  bootPromptInstallLicenseInactive: t('agent-chat.error.boot-prompt-install-license-inactive', "The owner of this App no longer qualifies to use this organization Agent, so the chat can't run. Trying again won't help."),
  // portal#916 — the reply was saved but the extraction was refused (hadron-server#3514). Only chosen under a
  // recognised structured partialTurn marker (see partialTurnRefusal); never names a task, revision, rule or config.
  partialTurnAttestationMissing: t('agent-chat.error.partial-turn-attestation-missing', "Your message was sent and the reply was saved, but the chat couldn't save the information it collected: this memory accepts that data only from a task-assigned author, and a chat turn doesn't name one. Ask whoever manages the memory. You don't need to send it again."),
  partialTurnAuthorTaskBroken: t('agent-chat.error.partial-turn-author-task-broken', "Your message was sent and the reply was saved, but the information it collected wasn't: the task this memory requires for that data is unavailable. It stays that way until whoever manages the memory repairs it. You don't need to send it again."),
  // portal#2065 B3: routing was refused (EDGE_CONDITION_FAILED) after the reply was saved. One fixed copy; never the
  // condition, rule or fact text. UX owns the wording at the design step.
  partialTurnEdgeConditionFailed: t('agent-chat.error.partial-turn-edge-condition-failed', "Your message was sent and the reply was saved, but the chat couldn't move on to the next step. You can keep chatting; there is no need to send it again."),
  // portal#2065 B4 (hadron-server#4039 B3): startChat refused with ENTRY_CONDITION_FAILED. One fixed message per messageId;
  // nothing from `detail` is shown, and an unknown id gets the generic one.
  startMemoryEncryptedNoKey: t('agent-chat.error.start-memory-encrypted-no-key', "This chat can't start because the memory it reads is encrypted and this session has no key for it. Ask whoever set up this agent to fix it."),
  startMemoryUnreadable: t('agent-chat.error.start-memory-unreadable', "This chat can't start because the memory it reads can't be read right now. Ask whoever set up this agent to fix it."),
  startInvalidCondition: t('agent-chat.error.start-invalid-condition', "This chat can't start because its first conversation's start condition can't be checked. Ask whoever set up this agent to fix it."),
  startTypeMismatch: t('agent-chat.error.start-type-mismatch', "This chat can't start because the information its start condition checks isn't in the form it expects. Ask whoever set up this agent to fix it."),
  startUnavailable: t('agent-chat.error.start-unavailable', "This chat can't start right now."),
  // portal#2683 (hadron-server#5394, hrn:node:hadronmemory.com:specs:cor:cht:010:02): startChat refused with
  // CHAT_APP_NOT_IDENTIFIED. The server never searches for an App, so a start must name one. Fixed copy, no ids.
  appNotIdentified: t('agent-chat.error.app-not-identified', "This chat can't start because it isn't tied to an App. Open it from an App that installs this Agent and try again."),
  failed: t('agent-chat.error.failed', 'Chat request failed. Please try again.'),
} as const;

export type ChatErrorCode = keyof typeof CHAT_ERROR;

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode) {
    super(CHAT_ERROR[code]);
    this.name = 'ChatError';
  }
}

/** Server `extensions.code` -> portal code. Keyed on the code alone, never on message text. */
const BOOT_PROMPT_REFUSALS: Readonly<Record<string, ChatErrorCode>> = {
  BOOT_PROMPT_NOT_SET: 'bootPromptNotSet',
  BOOT_PROMPT_TARGET_DELETED: 'bootPromptTargetDeleted',
  BOOT_PROMPT_NOT_APPROVED: 'bootPromptNotApproved',
  BOOT_PROMPT_NOT_SIGNED: 'bootPromptNotSigned',
  BOOT_PROMPT_RECORDED_REVISION_DELETED: 'bootPromptRecordedRevisionDeleted',
  BOOT_PROMPT_INSTALL_LICENSE_INACTIVE: 'bootPromptInstallLicenseInactive',
};

/** The portal code for a boot-prompt refusal, or null for any other error. */
export function bootPromptRefusalCode(error: unknown): ChatErrorCode | null {
  const serverCode = extractGqlErrorCode(error);
  return serverCode && Object.hasOwn(BOOT_PROMPT_REFUSALS, serverCode) ? BOOT_PROMPT_REFUSALS[serverCode] : null;
}

/** portal#2683: startChat refused because the call named no App (code alone, never the message). */
export function appNotIdentifiedCode(error: unknown): ChatErrorCode | null {
  return extractGqlErrorCode(error) === 'CHAT_APP_NOT_IDENTIFIED' ? 'appNotIdentified' : null;
}

/** portal#1963: startChat / sendChatMessage refused the `aiConfigChoice` (code alone, never the message). */
export function configChoiceRefusalCode(error: unknown): ChatErrorCode | null {
  return extractGqlErrorCode(error) === 'AiServiceConfigNotFoundError' ? 'configChoiceUnavailable' : null;
}

/** Server `messageId` -> portal code for ENTRY_CONDITION_FAILED at start (hadron-server#4039 B3). Closed set. */
const ENTRY_CONDITION_MESSAGES: Readonly<Record<string, ChatErrorCode>> = {
  'chat-start.error.memory_encrypted_no_key': 'startMemoryEncryptedNoKey',
  'chat-start.error.memory_unreadable': 'startMemoryUnreadable',
  'chat-start.error.invalid_condition': 'startInvalidCondition',
  'chat-start.error.type_mismatch': 'startTypeMismatch',
};

/** portal#2065 B4: the portal code for ENTRY_CONDITION_FAILED, keyed on the code and then the messageId; null for any other error. */
export function entryConditionRefusalCode(error: unknown): ChatErrorCode | null {
  if (extractGqlErrorCode(error) !== 'ENTRY_CONDITION_FAILED') return null;
  const id = extractGqlErrorExtensions(error)?.messageId;
  return typeof id === 'string' && Object.hasOwn(ENTRY_CONDITION_MESSAGES, id) ? ENTRY_CONDITION_MESSAGES[id] : 'startUnavailable';
}

/** "Fix the setup first" cases answer 409; anything else is a generic 500. */
const CONFLICT_CODES: ReadonlySet<ChatErrorCode> = new Set<ChatErrorCode>([
  'noConfig',
  'configChoiceUnavailable',
  'bootPromptNotSet',
  'bootPromptTargetDeleted',
  'bootPromptNotApproved',
  'bootPromptNotSigned',
  'bootPromptRecordedRevisionDeleted',
  'bootPromptInstallLicenseInactive',
  'startMemoryEncryptedNoKey',
  'startMemoryUnreadable',
  'startInvalidCondition',
  'startTypeMismatch',
  'startUnavailable',
  'appNotIdentified',
]);

export function publicChatError(error: unknown): { code: ChatErrorCode; message: string; status: number } {
  const code = error instanceof ChatError ? error.code : (bootPromptRefusalCode(error) ?? configChoiceRefusalCode(error) ?? entryConditionRefusalCode(error) ?? appNotIdentifiedCode(error) ?? 'failed');
  return { code, message: CHAT_ERROR[code], status: CONFLICT_CODES.has(code) ? 409 : 500 };
}

/** The two attestation refusals reachable through a chat turn's extraction -> portal code. */
const PARTIAL_TURN_REFUSALS: Readonly<Record<string, ChatErrorCode>> = {
  AUTHORING_ATTESTATION_MISSING: 'partialTurnAttestationMissing',
  AUTHOR_TASK_BROKEN: 'partialTurnAuthorTaskBroken',
};

const isStringArrayWith = (value: unknown, member: string) => Array.isArray(value) && value.includes(member);

/**
 * portal#916: `processChatResponse` is not atomic. When the authoring gate refuses the extraction the server has
 * already saved the assistant message and the counter, and says so in `extensions.partialTurn`
 * (hadron-server#3514, PR #3518). That marker is the ONLY evidence of what was saved (hrn:node:hadronmemory.com:specs:cor:cht:020:01, step 2), so
 * this is keyed on it and never on the code alone: the code without a recognised marker (a server without #3518,
 * a malformed report) stays the generic failure, and the reader is never told the reply was saved.
 *
 * Recognised = `persisted` includes ASSISTANT_MESSAGE, `refused` has an EXTRACTION entry whose code equals the
 * error's own code and is one of the two reachable ones, and `notRun` includes STAGE_PROGRESSION. Structured
 * fields only, never message text. Returns the fixed copy and the 409 (fix-the-setup class), or null.
 */
export function partialTurnRefusal(error: unknown): { code: ChatErrorCode; message: string; status: 409 } | null {
  const ext = extractGqlErrorExtensions(error);
  const serverCode = extractGqlErrorCode(error);
  if (serverCode === 'EDGE_CONDITION_FAILED') return edgeConditionPartialTurn(ext);
  if (!ext || !serverCode || !Object.hasOwn(PARTIAL_TURN_REFUSALS, serverCode)) return null;
  const report = ext.partialTurn;
  if (!report || typeof report !== 'object') return null;
  const { persisted, refused, notRun } = report as { persisted?: unknown; refused?: unknown; notRun?: unknown };
  const extractionRefused =
    Array.isArray(refused) &&
    refused.some((r) => !!r && typeof r === 'object' && (r as { component?: unknown }).component === 'EXTRACTION' && (r as { code?: unknown }).code === serverCode);
  if (!isStringArrayWith(persisted, 'ASSISTANT_MESSAGE') || !extractionRefused || !isStringArrayWith(notRun, 'STAGE_PROGRESSION')) return null;
  const code = PARTIAL_TURN_REFUSALS[serverCode];
  return { code, message: CHAT_ERROR[code], status: 409 };
}

/**
 * portal#2065 B3 (hadron-server S3, option (a)): routing ran and was refused AFTER the reply was saved. Recognised by
 * `refused` containing {STAGE_PROGRESSION, EDGE_CONDITION_FAILED} and `persisted` including ASSISTANT_MESSAGE, and by
 * nothing else: EXTRACTION in `persisted` is conditional (listed only when extraction wrote data), so it is never
 * required. Structured fields only; no condition, rule or fact text crosses. Relies on the still-Proposed partial-turn
 * rule in hrn:node:hadronmemory.com:specs:cor:cht:020:01.
 */
function edgeConditionPartialTurn(ext: Record<string, unknown> | null | undefined): { code: ChatErrorCode; message: string; status: 409 } | null {
  const report = ext?.partialTurn;
  if (!report || typeof report !== 'object') return null;
  const { persisted, refused } = report as { persisted?: unknown; refused?: unknown };
  const edgeRefused =
    Array.isArray(refused) &&
    refused.some((r) => !!r && typeof r === 'object' && (r as { component?: unknown }).component === 'STAGE_PROGRESSION' && (r as { code?: unknown }).code === 'EDGE_CONDITION_FAILED');
  if (!isStringArrayWith(persisted, 'ASSISTANT_MESSAGE') || !edgeRefused) return null;
  return { code: 'partialTurnEdgeConditionFailed', message: CHAT_ERROR.partialTurnEdgeConditionFailed, status: 409 };
}
