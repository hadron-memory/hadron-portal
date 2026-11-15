// portal#2129 rows 4 and 7: pure checks the layout script queues into its failure list.
// Same members, ignoring order, counting duplicates. Inputs are not mutated.
export function sameMembers(actual, expected) {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort(); const e = [...expected].sort();
  return a.every((x, i) => x === e[i]);
}
// The baseline (touch viewport => coarse pointer) is judged first and on its own. Only a correct
// baseline lets the injected expectation fire, so a mis-wired baseline can never read as a successful injection.
// The stable part of the wrong-baseline message; the self-test looks for its absence, so it is shared, not copied.
export const POINTER_REGRESSION = 'pointer baseline regression';
export function pointerVerdict({ width, actualCoarse, inject }) {
  const wantCoarse = width === 390;
  if (actualCoarse !== wantCoarse) {
    const name = c => (c ? 'coarse' : 'fine');
    return [`${POINTER_REGRESSION}: expected ${name(wantCoarse)} at ${width}, got ${name(actualCoarse)}`];
  }
  return inject ? ['pointer mode does not match the emulated device (injected)'] : [];
}
