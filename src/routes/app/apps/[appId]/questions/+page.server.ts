import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp, loadWriteCandidates } from '$lib/server/agent-tasks';
import { readAppQuestionLogs, readAppQuestions } from '$lib/server/app-questions';
import { parseQuestionsFilter, questionsNavigation, questionsServerArgs } from './filters';
import type { PageServerLoad } from './$types';

/**
 * portal#2235 (Questions P2) — the App's Questions sub-route. A sub-route of its own, like Tasks and Tickers, so a question
 * read that refuses a non-participant (APP_NOT_FOUND) can never reach the App page's loader. Read only: a row links to the
 * question's own page, where the card answers it.
 */
export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  const client = gqlClient(locals.token);

  // The App's header comes first and alone: a missing App is a 404 whatever the question read would have said.
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const { filter, malformed, canonical } = parseQuestionsFilter(url.searchParams);
  if (!canonical) {
    const target = new URL(url);
    for (const key of malformed) target.searchParams.delete(key);
    // #1738 (Refs #1394): wait for the app layout's active-org cookie write before redirecting.
    await parent();
    throw redirect(303, target.pathname + target.search);
  }

  const viewerId = locals.user?.id ?? null;
  const basePath = `/app/apps/${app.id}/questions`;
  const [questions, candidates] = await Promise.all([
    readAppQuestions(client, app.id, questionsServerArgs(filter, viewerId)),
    loadWriteCandidates(client, app.id),
  ]);
  // Only an empty page needs the logs: they tell "this App cannot be asked anything" from "nothing matches".
  const logs = questions.kind === 'ok' && questions.value.items.length === 0 ? await readAppQuestionLogs(client, app.id) : null;

  return {
    app,
    filter,
    viewerId,
    questions,
    logs,
    // Only the people: `peopleWithheld` means the server withheld the member list, which is not an App with no members.
    people: { people: candidates.people, withheld: candidates.peopleWithheld, failed: candidates.peopleFailed },
    navigation: questions.kind === 'ok' ? questionsNavigation(basePath, filter, questions.value.items.length, questions.value.total) : null,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};
