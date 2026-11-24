/**
 * portal#2582: the hadron-server's ceremony-link mint, as a fixture.
 *
 * The server builds the signing link for a secret change request as
 * `${getProjectBaseUrl()}${SECRET_CHANGE_PATH}/${id}` with `SECRET_CHANGE_PATH = '/secret-changes'`
 * (hadron-server `src/lib/secrets/changeRequests.ts`, lines 15 and 56 at server main 38178e1c).
 * The portal copies that shape by hand in `rebuildCeremonyUrl` (`src/lib/secrets/staged.ts`), so
 * this file is the one place the portal's tests state the SERVER's side of it. If the server
 * changes the path or the shape, update this fixture to match; the pin in
 * `src/lib/secrets/server-mint.test.ts` then fails until `staged.ts` follows.
 *
 * Do not import the portal's own path constant here: the point is an independent copy.
 */
const SECRET_CHANGE_PATH = '/secret-changes';

/** What the server mints for a request id, on its public origin. */
export const serverMint = (origin: string, id: string): string => `${origin}${SECRET_CHANGE_PATH}/${id}`;

/** Request ids in the shapes the server issues (a uuid and a 32-hex id), so the pin is not one lucky string. */
export const SERVER_REQUEST_IDS = ['0d6f6b1e-5a0c-4a53-9d1f-7a1f2f5f3b11', '01a20e82ddd17444a440b23608187b3d'] as const;
