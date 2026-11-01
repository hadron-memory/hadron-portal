// Moved to $lib/forms so the node detail page's Chat tab can share it.
export { sendChatMessageSchema, type SendChatMessageSchema } from '$lib/forms/chat-message-schema';
// #1522: this surface's superforms id helper (loader and action share it).
export { sendMessageFormId } from '$lib/forms/chat-message-schema';
