import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APP_QUESTIONS_QUERY, APP_QUESTION_LOGS_QUERY } from '$lib/server/queries';

/**
 * portal#2235 — the App's Questions reads. Each says one of three things, so the view never confuses them
 * (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch): `ok`, `not-participant` (the server answered
 * APP_NOT_FOUND, which is how a read refuses someone who takes no part in the App) or `failed`, never an empty list.
 */
export type QuestionsRead<T> = { kind: 'ok'; value: T } | { kind: 'not-participant' } | { kind: 'failed' };

/** The people and parties the list selects: a person by name and handle, a worker or App by name and URN. Never an account id for display. */
export type ListPerson = { id: string; name: string | null; handle: string | null };
export type ListParty = { id: string; name: string | null; urn: string | null };
export type ListAsker = { user: ListPerson | null; worker: ListParty | null; app: ListParty | null };

export type QuestionListRow = {
  id: string;
  urn: string;
  portalUrl: string | null;
  code: string;
  title: string;
  state: string;
  answered: boolean;
  priority: string | null;
  tier: string | null;
  askedAt: string | null;
  answeredAt: string | null;
  revSeq: number;
  answer: { key: string | null; text: string | null; at: string } | null;
  effectiveAssignee: ListPerson | null;
  askedBy: ListAsker | null;
};
export type QuestionListPage = { total: number; items: QuestionListRow[] };
export type QuestionLogPerson = { id: string; name: string | null; handle: string | null };
export type QuestionLogRow = {
  id: string; urn: string; name: string; memoryId: string; prefix: string;
  portalUrl: string | null; revSeq: number; defaultDeciders: QuestionLogPerson[]; eligibleDeciders: QuestionLogPerson[];
};

function classify<T>(e: unknown, what: string): QuestionsRead<T> {
  if (extractGqlErrorCode(e) === 'APP_NOT_FOUND') return { kind: 'not-participant' };
  console.warn(`[questions] ${what} failed:`, e);
  return { kind: 'failed' };
}

export async function readAppQuestions(
  client: GraphQLClient,
  appRef: string,
  /** The server's filter arguments (`questionsServerArgs` in the route's filters.ts): every filter is the server's. */
  args: Record<string, unknown>,
): Promise<QuestionsRead<QuestionListPage>> {
  try {
    const r = await client.request<{ questions: QuestionListPage }>(APP_QUESTIONS_QUERY, { appRef, ...args });
    return { kind: 'ok', value: { total: r.questions.total, items: r.questions.items } };
  } catch (e) {
    return classify(e, `questions read for ${appRef}`);
  }
}

export async function readAppQuestionLogs(client: GraphQLClient, appRef: string): Promise<QuestionsRead<QuestionLogRow[]>> {
  try {
    const r = await client.request<{ questionLogs: QuestionLogRow[] }>(APP_QUESTION_LOGS_QUERY, { appRef });
    return { kind: 'ok', value: r.questionLogs };
  } catch (e) {
    return classify(e, `question logs read for ${appRef}`);
  }
}
