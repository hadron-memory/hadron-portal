/**
 * portal#2582 (from #2580 LOCAL F1): `rebuildCeremonyUrl` copies the server's mint shape by hand.
 * Nothing tied the two together, so a server path change would break only the portal's revisit
 * links. This pin builds the link the way the server does (the fixture) and requires the portal's
 * rebuild to equal it, and to be accepted by the staged-refusal path too.
 */
import { describe, expect, it } from 'vitest';
import { rebuildCeremonyUrl, safeCeremonyUrl } from './staged';
import { SERVER_REQUEST_IDS, serverMint } from '$lib/test/fixtures/server-secret-change-mint';

const ORIGINS = ['https://hadron.example', 'https://hadronmemory.com', 'http://localhost:4000'];

describe('the revisit link equals the server mint (portal#2582)', () => {
  // Kills: either side changing the ceremony path or shape alone. Mutate the fixture's path or staged.ts's '/secret-changes/' and this goes red.
  it.each(ORIGINS.flatMap((o) => SERVER_REQUEST_IDS.map((id) => [o, id] as const)))('%s + %s', (origin, id) => {
    expect(rebuildCeremonyUrl(id, origin)).toBe(serverMint(origin, id));
  });
  // The staged refusal link (the server's own, copied verbatim) must pass the same pin the rebuild goes through.
  it('the pinned check accepts what the server mints', () => {
    for (const o of ORIGINS) for (const id of SERVER_REQUEST_IDS) expect(safeCeremonyUrl(serverMint(o, id), o)).toBe(serverMint(o, id));
  });
});
