/** portal#2234: the three question form actions, shared by the page and its server module. */
export const QUESTION_ACTION_KINDS: readonly string[] = ['answerQuestion', 'retractQuestionAnswer', 'withdrawQuestion'];

export type QuestionFormResult = { kind: string; ok?: boolean; error?: string; message?: string };

/** The page's `form` prop when a question action answered it, else null: the card shows it, the page banner must not. */
export function questionResultOf(form: unknown): QuestionFormResult | null {
  if (!form || typeof form !== 'object' || !('kind' in form)) return null;
  return QUESTION_ACTION_KINDS.includes(String((form as { kind: unknown }).kind)) ? (form as QuestionFormResult) : null;
}
