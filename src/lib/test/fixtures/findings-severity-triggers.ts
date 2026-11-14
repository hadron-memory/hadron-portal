// portal#2129 row 5: the two adversarial severity triggers from #2115 QA F1 / #2119, in a module with no imports
// so a unit test can use them without pulling in the fixture-mount component graph.
// These are synthetic out-of-set labels, NOT the real severity set (P1/P2/P3/note); never narrow or merge them.
// The markers are built from code points, so the source holds no invisible character.
const severityWithSixMarkers = 'sev-A' + [0x2061, 0x2062, 0x2063, 0x2064, 0x2028, 0x2029].map((cp, i) => String.fromCodePoint(cp) + 'BCDEFG'[i]).join('');
export const FINDINGS_SEVERITIES = { markers: severityWithSixMarkers, plain: 'S'.repeat(80) } as const;
