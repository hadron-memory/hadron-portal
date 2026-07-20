import { submittedForm } from './submitted-form';

type FormField<T> = Extract<keyof T, string> | '_kind';
// Flat field-error maps only. Keep nested schema errors local at the call site
// until a route needs shared nested-path handling.
type FormErrors<T> = Partial<Record<FormField<T>, string[] | undefined>>;

export function scopedActionError<T extends { _kind?: string }>(
  actionData: unknown,
  kind: T['_kind'],
  message: App.Superforms.Message | null | undefined,
  errors?: FormErrors<T> | null,
  fieldFallbacks: readonly FormField<T>[] = ['_kind'],
): string | null {
  const submitted = submittedForm<T>(actionData, kind);
  if (!submitted) return null;
  if (message?.type === 'error') return message.text;

  for (const field of fieldFallbacks) {
    const fieldError = errors?.[field]?.[0];
    if (fieldError) return fieldError;
  }
  return null;
}

export function scopedActionSuccess<T extends { _kind?: string }>(
  actionData: unknown,
  kind: T['_kind'],
  message: App.Superforms.Message | null | undefined,
): string | null {
  const submitted = submittedForm<T>(actionData, kind);
  return submitted && message?.type === 'success' ? message.text : null;
}
