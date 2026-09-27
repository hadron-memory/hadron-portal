import type { SuperValidated } from 'sveltekit-superforms';

export function submittedForm<T extends { _kind?: string }>(
  actionData: unknown,
  kind: T['_kind'],
): SuperValidated<T, App.Superforms.Message, T> | null {
  const candidate = actionData && typeof actionData === 'object' && 'form' in actionData
    ? actionData.form
    : null;
  const candidateData = candidate && typeof candidate === 'object' && 'data' in candidate
    ? candidate.data
    : null;
  const candidateKind = candidateData && typeof candidateData === 'object' && '_kind' in candidateData
    ? String(candidateData._kind)
    : null;
  return candidateKind === kind
    ? candidate as unknown as SuperValidated<T, App.Superforms.Message, T>
    : null;
}

/**
 * #957 — the submitted form, but only when that submission FAILED: refused by
 * validation (`fail(400, { form })`) or answered with an error message.
 *
 * A component that seeds a superForm from the page's action data should use
 * this to preserve an unsent draft, not `submittedForm`: a SUCCESSFUL action
 * returns the posted values too, so seeding from it re-fills the form with
 * what was already sent whenever the component remounts while that action
 * data is still on the page — and superForm's `resetForm` then resets TO it.
 */
export function failedSubmission<T extends { _kind?: string }>(
  actionData: unknown,
  kind: T['_kind'],
): SuperValidated<T, App.Superforms.Message, T> | null {
  const form = submittedForm<T>(actionData, kind);
  return form && (!form.valid || form.message?.type === 'error') ? form : null;
}
