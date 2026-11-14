// portal#2129 rows 4 and 7: pure checks the layout script queues into its failure list.
// Same members, ignoring order, counting duplicates. Inputs are not mutated.
export function sameMembers(actual, expected) {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort(); const e = [...expected].sort();
  return a.every((x, i) => x === e[i]);
}
// The baseline (touch viewport => coarse pointer) is judged first and on its own. Only a correct
// baseline lets the injected expectation fire, so a mis-wired baseline can never read as a successful injection.
export function pointerVerdict({ width, actualCoarse, inject }) {
  const wantCoarse = width === 390;
  if (actualCoarse !== wantCoarse) {
    const name = c => (c ? 'coarse' : 'fine');
    return [`pointer baseline regression: expected ${name(wantCoarse)} at ${width}, got ${name(actualCoarse)}`];
  }
  return inject ? ['pointer mode does not match the emulated device (injected)'] : [];
}
