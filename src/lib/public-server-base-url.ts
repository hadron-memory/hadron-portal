import { env as publicEnv } from '$env/dynamic/public';

/**
 * The hadron-server origin the READER'S BROWSER sees — OAuth start hand-overs,
 * MCP config snippets, the passkey pages. PUBLIC, not the server-to-server
 * `serverBaseUrl()` (`$env/dynamic/private`, unreachable from client code):
 * URLs built from it are pasted into a terminal, opened in a tab or handed to
 * another device, so they must be reachable from outside the portal's network
 * (portal#1022; previously six inline copies of the same expression).
 *
 * Isomorphic on purpose: this module imports only `$env/dynamic/public`, so
 * both server loaders and client components can call it.
 */
export function publicServerBaseUrl(): string {
  return publicEnv.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
}
