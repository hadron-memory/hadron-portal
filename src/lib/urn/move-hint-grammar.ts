/**
 * Which URN grammar the move dialog's hint should show, for a given node.
 *
 * The hint is the only place the dialog says what shape to type, so it has to
 * agree with what the field is prefilled with — a hint that contradicts the
 * field's own contents is what #779 was.
 *
 * There are two populations, and one hint cannot serve both:
 *
 *   - Almost every node: a v2 URN, `hrn:node:<root>:<memory>:<loc>`.
 *   - A node in a memory addressed by a v1 OWNERSHIP CHAIN
 *     (`<org>::<app>::<agent>::<memory>`): `composeNodeUrn` emits those
 *     unchanged, because a chain has no string-derivable v2 form — v2's fixed
 *     arity would read atom 1 as the memory slug and fold the rest into the
 *     loc. See `compose-node-urn.ts` and cor:urn:010:01.
 *
 * Showing the v2 grammar to the second population is worse than showing v1 to
 * the first (@codex P1 on PR #803). A v1 example produces a REFUSAL —
 * `parseUrnV2` rejects `::`, so the user learns immediately. Telling a
 * chain-owned node to flatten produces a URN that resolves **successfully to a
 * different node**, and the move reports success.
 *
 * The test is run against the COMPOSED node URN, not the memory URN's atom
 * count: `composeNodeUrn` has already made the v1/v2 decision, and re-deriving
 * it here is how the two drift apart. `::` appears in its output only for the
 * chain case.
 */
export const MOVE_HINT_GRAMMAR_V2 = 'hrn:node:<root>:<memory>:<loc>';
export const MOVE_HINT_GRAMMAR_CHAIN = 'hrn:node:<org>::<app>::<agent>::<memory>::<loc>';

/** Is this composed node URN addressed through a v1 ownership chain? */
export function isOwnershipChainUrn(fullUrn: string | null | undefined): boolean {
  return (fullUrn ?? '').includes('::');
}

/** The grammar to show beside the move input for this node. */
export function moveHintGrammar(fullUrn: string | null | undefined): string {
  return isOwnershipChainUrn(fullUrn) ? MOVE_HINT_GRAMMAR_CHAIN : MOVE_HINT_GRAMMAR_V2;
}
