/**
 * portal#2582 (from #2580 LOCAL F1): `rebuildCeremonyUrl` copies the server's mint shape by hand.
 * This pin ties it to a RECORDED copy of that shape (the fixture), so the portal cannot drift from
 * what was recorded. It cannot see the server change: that needs a server `ceremonyUrl` field.
 */
import { describe, expect, it } from 'vitest';
import { rebuildCeremonyUrl, safeCeremonyUrl } from './staged';
import { recordedServerMint, SERVER_REQUEST_IDS } from '$lib/test/fixtures/server-secret-change-mint';

const ORIGINS = ['https://hadron.example', 'https://hadronmemory.com', 'http://localhost:4000'];
const CASES = ORIGINS.flatMap((origin) => SERVER_REQUEST_IDS.map((id) => ({ origin, id })));

describe('the revisit link matches the recorded server mint (portal#2582)', () => {
  // Kills: the fixture's path or shape, or staged.ts's '/secret-changes/' or shape, changing alone.
  it.each(CASES)('rebuild on $origin for request $id', ({ origin, id }) => {
    expect(rebuildCeremonyUrl(id, origin)).toBe(recordedServerMint(origin, id));
  });
  // The staged-refusal link (the server's own, copied verbatim) goes through the same pin; its negative cases live in staged.test.ts.
  it.each(CASES)('the pinned check accepts the recorded mint on $origin for request $id', ({ origin, id }) => {
    expect(safeCeremonyUrl(recordedServerMint(origin, id), origin)).toBe(recordedServerMint(origin, id));
  });
});
