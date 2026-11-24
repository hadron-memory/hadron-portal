/**
 * A recorded copy of the shape the hadron-server mints for a secret change request's signing link:
 * the server's public origin, then `/secret-changes`, then the request id (server file
 * `src/lib/secrets/changeRequests.ts`).
 *
 * This is a RECORD, not a live link to the server: it is a second hand-written copy, so it catches
 * the portal's `rebuildCeremonyUrl` (`src/lib/secrets/staged.ts`) drifting from the shape recorded
 * here, and nothing in the portal's tests can see the server change. When the server's mint
 * changes, update this file first; the pin in `src/lib/secrets/server-mint.test.ts` then names
 * what the portal must follow. The durable fix is a server `ceremonyUrl` on the change-request
 * read, after which the portal stops composing the link.
 *
 * It deliberately does not import the portal's own path: the point is an independent copy.
 */
const SECRET_CHANGE_PATH = '/secret-changes';

/** The link the server mints, as recorded, for a request id on its public origin. */
export const recordedServerMint = (origin: string, id: string): string => `${origin}${SECRET_CHANGE_PATH}/${id}`;

/** Request ids in the shapes the server issues (a uuid and a 32-hex id), so the pin is not one lucky string. */
export const SERVER_REQUEST_IDS = ['0d6f6b1e-5a0c-4a53-9d1f-7a1f2f5f3b11', '01a20e82ddd17444a440b23608187b3d'] as const;
