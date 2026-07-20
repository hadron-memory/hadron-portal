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
