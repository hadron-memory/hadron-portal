import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp, loadWriteCandidates } from '$lib/server/agent-tasks';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { readAppQuestionLogs, readAppQuestions } from '$lib/server/app-questions';
import { CREATE_QUESTION_LOG_MUTATION } from '$lib/server/queries';
import { signinRedirectFor } from '$lib/server/session-action-guard';
import { questionLogRefusal } from '$lib/questions/refusal';
import { t } from '$lib/i18n/t';
import { readAppMemoryScope } from '../app-memories';
import { parseQuestionsFilter, questionsNavigation, questionsServerArgs } from './filters';
import { LOG_LOC, LOG_NAME, parseSetupForm, setupDeciderChoices, setupMemoryChoices } from './setup';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#2235 (Questions P2) — the App's Questions sub-route. A sub-route of its own, like Tasks and Tickers, so a question
 * read that refuses a non-participant (APP_NOT_FOUND) can never reach the App page's loader. A row links to the question's own page,
 * where the card answers it. portal#2237 (P4) adds the one write here: setting up the App's question log.
 */
const viewerOf = (locals: App.Locals) => ({ id: locals.user?.id ?? null, name: locals.user?.name ?? locals.user?.email ?? null });

export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  const client = gqlClient(locals.token);

  // The App's header comes first and alone: a missing App is a 404 whatever the question read would have said.
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const { filter, malformed, rewrite, canonical } = parseQuestionsFilter(url.searchParams);
  if (!canonical) {
    const target = new URL(url);
    for (const key of malformed) target.searchParams.delete(key);
    for (const [key, value] of Object.entries(rewrite)) target.searchParams.set(key, value);
    // #1738 (Refs #1394): wait for the app layout's active-org cookie write before redirecting.
    await parent();
    throw redirect(303, target.pathname + target.search);
  }

  const viewer = viewerOf(locals);
  const basePath = `/app/apps/${app.id}/questions`;
  const [questions, candidates, logs] = await Promise.all([
    readAppQuestions(client, app.id, questionsServerArgs(filter, viewer.id)),
    loadWriteCandidates(client, app.id),
    // Every page: the log lines above the list say who decides, and an empty list needs to know whether there is a log at all.
    readAppQuestionLogs(client, app.id),
  ]);
  const people = { people: candidates.people, withheld: candidates.peopleWithheld === true, failed: candidates.peopleFailed === true };

  // The form is for an App with no log, so only then is the memory scope read.
  const setup = logs.kind === 'ok' && logs.value.length === 0 && viewer.id
    ? {
        memories: setupMemoryChoices(await readAppMemoryScope(client, app.id)),
        deciders: setupDeciderChoices(people, { id: viewer.id, name: viewer.name }),
        viewer: { id: viewer.id, name: viewer.name, handle: null },
      }
    : null;

  return {
    app,
    filter,
    viewerId: viewer.id,
    questions,
    logs,
    // Only the people: `peopleWithheld` means the server withheld the member list, which is not an App with no members.
    people,
    setup,
    navigation: questions.kind === 'ok' ? questionsNavigation(basePath, filter, questions.value.items.length, questions.value.total) : null,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

type Submitted = { memoryId: string; deciders: string[] };
/** A refusal hands the submitted choices back, so the form keeps them instead of resetting. */
const refuse = (status: number, error: string, values?: Submitted) => fail(status, { createLog: { error, values } });
const submittedOf = (form: FormData): Submitted => ({
  memoryId: typeof form.get('memoryId') === 'string' ? (form.get('memoryId') as string) : '',
  deciders: form.getAll('deciders').filter((v): v is string => typeof v === 'string'),
});

export const actions: Actions = {
  /**
   * Set up the App's question log. The server decides who may (a manager of the memory, or an owner-role member of its App):
   * the portal does not guess, it shows the typed refusal. What it checks itself is that the memory and the deciders are ones the form
   * offered, so a crafted POST cannot name anything else.
   */
  createQuestionLog: async ({ request, params, locals, url }) => {
    if (!locals.token) throw redirect(303, signinRedirectFor(url));
    if (locals.impersonation) {
      return refuse(403, t('app.questions.setup.impersonating', 'Questions cannot be set up while impersonating.'));
    }
    const viewer = viewerOf(locals);
    if (!viewer.id) return refuse(400, t('question.log.refusal.invalid', 'Choose a memory and at least one person who decides.'));
    const client = gqlClient(locals.token);
    const [scope, candidates] = await Promise.all([readAppMemoryScope(client, params.appId), loadWriteCandidates(client, params.appId)]);
    const formData = await request.formData();
    const submitted = submittedOf(formData);
    // An unreadable scope is a load failure, never "no memory was offered": the person's choice may well be valid.
    const offered = setupMemoryChoices(scope);
    if (offered === null) return refuse(503, t('app.questions.setup.memories-failed', 'Couldn’t load the App’s memories. Reload to try again.'), submitted);
    const choices = setupDeciderChoices({ people: candidates.people, withheld: candidates.peopleWithheld === true, failed: candidates.peopleFailed === true }, { id: viewer.id, name: viewer.name });
    const parsed = parseSetupForm(formData, offered, choices);
    if (!parsed.ok) return refuse(400, t('question.log.refusal.invalid', 'Choose a memory and at least one person who decides.'), submitted);
    try {
      await client.request(CREATE_QUESTION_LOG_MUTATION, { memoryRef: parsed.memoryRef, loc: LOG_LOC, name: LOG_NAME, defaultDeciders: parsed.deciders });
    } catch (e) {
      const code = extractGqlErrorCode(e);
      const known = questionLogRefusal(code);
      // "Choose another memory" is a dead end when this App offers only one: say there is no other.
      if (known && code === 'QUESTION_LOG_EXISTS' && offered.length === 1) {
        return refuse(known.status, t('question.log.refusal.exists-only', "That memory already has, or once had, a node at 'questions', and this form offers no other memory."), submitted);
      }
      if (known) return refuse(known.status, known.text, submitted);
      return refuse(500, extractGqlError(e, t('question.log.refusal.generic', 'The question log could not be set up.'), [], { transport: 'fallback' }), submitted);
    }
    throw redirect(303, `/app/apps/${params.appId}/questions`);
  },
};
