/**
 * `$app/forms` for the real-Chromium probes that need an ACTUAL fetch round trip
 * (portal#1796, scripts/test-cast-submit-focus.mjs). The client-lane stub
 * (app-forms.ts) never submits; kit's real module needs kit's client runtime, which
 * is not started in a bare-document harness (its `deserialize` reads `app.decoders`
 * and throws, so every answer lands in superforms' onError).
 *
 * This replica keeps what the probes depend on: the form's real `submit` event, a real
 * `fetch` POST to the form's action, superforms' own submit callback and result handler.
 * It differs from kit in one way: `data` in the answer is plain JSON, not devalue.
 * It does no focus handling of its own (kit's `update()` is never called by superforms
 * here, because the page sets applyAction: false), so focus behaviour under test is the page's.
 */
type Submit = (input: Record<string, unknown>) => unknown;

export function enhance(form: HTMLFormElement, submit?: Submit): { destroy: () => void } {
  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const action = new URL(form.action);
    const formData = new FormData(form);
    const controller = new AbortController();
    let cancelled = false;
    const handler = (await submit?.({
      action,
      formData,
      formElement: form,
      controller,
      submitter: event.submitter,
      cancel: () => { cancelled = true; },
    })) as ((e: Record<string, unknown>) => Promise<void>) | undefined;
    if (cancelled) return;
    let result: unknown;
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
        body: formData,
        signal: controller.signal,
      });
      result = deserialize(await response.text());
    } catch (error) {
      result = { type: 'error', error };
    }
    await handler?.({ action, formData, formElement: form, result, update: async () => {} });
  };
  form.addEventListener('submit', onSubmit);
  return { destroy: () => form.removeEventListener('submit', onSubmit) };
}

export function deserialize(text: string): unknown {
  return JSON.parse(text);
}

export async function applyAction(): Promise<void> {}
