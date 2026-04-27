/**
 * Decides whether a given message in `chat.messages` should currently be
 * rendered as plain text (mid-stream) or as parsed markdown (complete).
 *
 * A message is "streaming" iff:
 *   - the chat is in the 'streaming' status, AND
 *   - it is the last message in the array (the only one tokens can still
 *     be appended to), AND
 *   - it is an assistant message (user messages are static the moment
 *     they're submitted).
 *
 * Returning true tells the component to skip marked.parse() and render a
 * cursor; returning false tells it to render the final markdown.
 */
export function isMessageStreaming(args: {
  status: string;
  index: number;
  total: number;
  role: string;
}): boolean {
  return (
    args.status === 'streaming' &&
    args.index === args.total - 1 &&
    args.role !== 'user'
  );
}
