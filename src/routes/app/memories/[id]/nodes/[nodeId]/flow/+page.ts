// Svelte Flow measures nodes in the browser; render this page client-only.
// The +page.server.ts load still runs on the server (GraphQL is server-side).
export const ssr = false;
