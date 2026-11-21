import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { signinRedirectFor } from '$lib/server/session-action-guard';
import { parseExpectedRevision } from '$lib/node-revision';
import { questionRefusal, refusalNeedsReload } from '$lib/questions/refusal';
import { ANSWER_QUESTION_MUTATION, QUESTION_BY_REF_QUERY, RETRACT_QUESTION_ANSWER_MUTATION, WITHDRAW_QUESTION_MUTATION } from '$lib/server/queries';
import type { QuestionCardData, QuestionCardView } from '$lib/questions/types';
import type { TaskRead } from '$lib/agent-tasks/types';
import { t } from '$lib/i18n/t';

/** portal#2234: the card's read, three-way so a failed read is never an empty card. */
export async function loadQuestion(
  client: GraphQLClient,
  nodeId: string,
  viewer: { id: string | null; impersonating: boolean },
): Promise<TaskRead<QuestionCardView>> {
  try {
    const r = await client.request<{ question: QuestionCardData | null }>(QUESTION_BY_REF_QUERY, { ref: nodeId });
    // `null` is the server hiding an unreadable question; for a node the page
    // already loaded it cannot happen, so it is a failure, not an absence.
    if (!r.question) return { kind: 'failed' };
    return { kind: 'ok', value: { ...r.question, viewerId: viewer.id, impersonating: viewer.impersonating } };
  } catch (e) {
    console.warn('[question-card] read failed:', e);
    return { kind: 'failed' };
  }
}

export type QuestionActionKind = 'answerQuestion' | 'retractQuestionAnswer' | 'withdrawQuestion';
export type QuestionActionResult = { kind: QuestionActionKind; ok: boolean; message?: string; error?: string; reload?: boolean };

const refuse = (kind: QuestionActionKind, status: number, error: string, reload = false): ActionFailure<QuestionActionResult> =>
  fail(status, { kind, ok: false, error, reload });

type Ctx = { request: Request; params: { nodeId: string }; locals: App.Locals; url: URL };

/**
 * The shared spine of the three question actions, in the order the issue pins:
 * sign-in, impersonation, then the form, then one mutation, then a known-codes-only
 * refusal map. `build` turns the parsed form into the mutation and its variables,
 * or an early refusal that makes no request.
 */
async function run(
  kind: QuestionActionKind,
  ctx: Ctx,
  build: (f: { revision: number; optionKey: string | null; text: string | null; reason: string | null }) => { doc: string; vars: Record<string, unknown>; ok: string } | { error: string },
  client: (token: string) => GraphQLClient,
) {
  const { request, params, locals, url } = ctx;
  if (!locals.token) throw redirect(303, signinRedirectFor(url));
  if (locals.impersonation) {
    return refuse(kind, 403, t('question.refusal.impersonation', 'Questions cannot be answered while impersonating.'));
  }
  const form = await request.formData();
  const str = (n: string) => {
    const v = form.get(n);
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const revision = parseExpectedRevision(form.get('revision'));
  if (revision === null) return refuse(kind, 400, t('question.refusal.reload', 'Reload the page and try again.'));
  const built = build({ revision, optionKey: str('optionKey'), text: str('text'), reason: str('reason') });
  if ('error' in built) return refuse(kind, 400, built.error);
  try {
    await client(locals.token).request(built.doc, { ref: params.nodeId, ...built.vars });
    return { kind, ok: true, message: built.ok } satisfies QuestionActionResult;
  } catch (e) {
    const code = extractGqlErrorCode(e);
    const known = questionRefusal(code);
    if (known) return refuse(kind, known.status, known.text, refusalNeedsReload(code));
    return refuse(kind, 500, extractGqlError(e, t('question.refusal.generic', 'The question could not be updated.'), [], { transport: 'fallback' }));
  }
}

export const answerQuestionAction = (ctx: Ctx, client: (token: string) => GraphQLClient) =>
  run('answerQuestion', ctx, ({ revision, optionKey, text, reason }) => {
    if (!optionKey && !text) return { error: t('question.refusal.empty', 'Pick an option or write an answer.') };
    return {
      doc: ANSWER_QUESTION_MUTATION,
      vars: { expectedRevision: revision, input: { ...(optionKey ? { optionKey } : {}), ...(text ? { text } : {}), ...(reason ? { reason } : {}), via: 'PORTAL' } },
      ok: optionKey ? t('question.status.answered', 'Answered {key}', { key: optionKey }) : t('question.status.answered-text', 'Answer sent'),
    };
  }, client);

export const retractQuestionAnswerAction = (ctx: Ctx, client: (token: string) => GraphQLClient) =>
  run('retractQuestionAnswer', ctx, ({ revision, reason }) => ({
    doc: RETRACT_QUESTION_ANSWER_MUTATION,
    vars: { expectedRevision: revision, via: 'PORTAL', ...(reason ? { reason } : {}) },
    ok: t('question.status.retracted', 'Answer taken back'),
  }), client);

export const withdrawQuestionAction = (ctx: Ctx, client: (token: string) => GraphQLClient) =>
  run('withdrawQuestion', ctx, ({ revision, reason }) => {
    if (!reason) return { error: t('question.refusal.reason-required', 'Say why you are withdrawing it.') };
    return { doc: WITHDRAW_QUESTION_MUTATION, vars: { expectedRevision: revision, reason }, ok: t('question.status.withdrawn', 'Question withdrawn') };
  }, client);
