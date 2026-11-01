import { z } from 'zod';

// Shared by the standalone chat page (`?/sendMessage`) and the node detail
// page's Chat tab (`?/sendChatMessage`) — same `_kind`, so ChatThread.svelte
// can scope action errors identically on both surfaces.
export const sendChatMessageSchema = z.object({
  _kind: z.literal('sendChatMessage').default('sendChatMessage'),
  content: z.string().trim().min(1, 'Message cannot be empty').prefault(''),
});

export type SendChatMessageSchema = typeof sendChatMessageSchema;

// #1522: one superforms id per surface AND node, so the two composers never
// share one (they both defaulted to this schema's shape hash), and a late
// result posted on one node's composer is consumed by no other form
// (`bootStart:<agentId>` pattern). Helpers rather than constants because the
// id is node-scoped, and ONE template underlying both because loader and
// action MUST agree — superforms routes results by exact id match, and a drift
// there silences all reporting with no error or warning. A third chat send
// surface adds a named wrapper here, never an inline literal at a call site.
const chatSendFormId = (action: string, nodeId: string): string => `${action}:${nodeId}`;
/** The node page's Chat tab surface (`?/sendChatMessage`). */
export const sendChatMessageFormId = (nodeId: string): string => chatSendFormId('sendChatMessage', nodeId);
/** The standalone /chat page's surface (`?/sendMessage`). */
export const sendMessageFormId = (nodeId: string): string => chatSendFormId('sendMessage', nodeId);
