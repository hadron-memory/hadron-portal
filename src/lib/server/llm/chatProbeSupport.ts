/**
 * #2217: a server that predates `chatProbe` (hadron-server#4005) rejects the saved Test
 * document at validation, so nothing reached the provider. That one error is tolerated: the
 * Test is sent again without the chat leg and shows the Run row only. Anything else (a rate
 * limit, not-found, a closed chat failure, a transport error) is not absence and still fails.
 *
 * The text match is graphql-js's `Unknown argument "chatProbe" on field ...` validation message,
 * pinned on purpose; the structural guards (no `path`, validation code or none) keep an
 * ordinary resolver error from ever matching.
 */
const CHAT_PROBE_ARGUMENT = 'Unknown argument "chatProbe" on field';
const CHAT_RESULT_FIELD = 'Cannot query field "chat" on type "AiServiceConfigTestResult".';

export function chatProbeUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const errors = (error as { response?: { errors?: unknown } }).response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  const validation = errors.every(e =>
    e !== null && typeof e === 'object' && typeof e.message === 'string' &&
    (e.message.startsWith(CHAT_PROBE_ARGUMENT) || e.message.startsWith(CHAT_RESULT_FIELD)) &&
    e.path == null && (e.extensions?.code === undefined || e.extensions.code === 'GRAPHQL_VALIDATION_FAILED'));
  return validation && errors.some(e => e.message.startsWith(CHAT_PROBE_ARGUMENT));
}
