/**
 * Which URN grammar the move dialog's hint should show.
 *
 * The hint is the only place the dialog says what shape to type, so its one
 * job is to agree with what is IN THE FIELD. #779 was that agreement broken
 * one way (a v1 example beside a v2 value); the review of the fix found it
 * broken the other two ways. All three are the same bug.
 *
 * ## Derive from the field, not from the node
 *
 * The obvious source is the node's own URN. It is wrong, because the field
 * does not stay on the node: the memory picker (#512) rewrites the target to a
 * DIFFERENT memory, which may have a different grammar from the one the node
 * came from. Moving an ordinary node into a chain-owned memory then puts `::`
 * in the field while a node-derived hint still advertises v2, and moving the
 * other way inverts it (@codex P1 on PR #803).
 *
 * Taking the current field value removes the whole class: there is no state to
 * keep in step, the hint simply describes what the user is looking at, and it
 * follows the picker, typing, and the initial prefill alike.
 *
 * ## Two populations
 *
 *   - v2 (almost everything): `hrn:node:<root>:<memory>:<loc>`.
 *   - A v1 OWNERSHIP CHAIN: `composeNodeUrn` emits these unchanged, because a
 *     chain has no string-derivable v2 form — v2's fixed arity would read atom
 *     1 as the memory slug and fold the rest into the loc. See
 *     `compose-node-urn.ts` and cor:urn:010:01.
 *
 * Getting the second one wrong is the dangerous direction. A v1 example shown
 * to a v2 value produces a REFUSAL (`parseUrnV2` rejects `::`), so the user
 * learns at once. Telling a chain-owned value to flatten produces a URN that
 * resolves SUCCESSFULLY to a different node.
 *
 * ## A chain's arity is not fixed
 *
 * A chain is any memory path with MORE than two atoms, so three-atom chains
 * exist and `composeNodeUrn`'s own tests exercise one. A hard-coded
 * `<org>::<app>::<agent>::<memory>` therefore disagrees with a three-atom
 * value and invites the user to invent an ownership level (@codex P2).
 *
 * So for a chain we echo the value's OWN prefix and only stand in for the loc:
 * `hrn:node:acme::billing::system::<loc>`. That is arity-proof by construction
 * and is a real example rather than a template — which is what makes it usable
 * for the case it exists to serve.
 */
export const MOVE_HINT_GRAMMAR_V2 = 'hrn:node:<root>:<memory>:<loc>';

/** The v1 hierarchy separator. A composed URN contains it only for a chain. */
const CHAIN_SEP = '::';

/** Is this URN addressed through a v1 ownership chain? */
export function isOwnershipChainUrn(urn: string | null | undefined): boolean {
  return (urn ?? '').includes(CHAIN_SEP);
}

/**
 * The grammar to show beside the move input, for the URN currently in it.
 *
 * For a chain, the value's own memory prefix is kept and only the loc is
 * replaced by a placeholder. The split is on the LAST `::` because that is
 * where `composeNodeUrn` joins the chain to the loc — and a loc may itself
 * contain single colons, which is why this cannot split on `:`.
 */
export function moveHintGrammar(urn: string | null | undefined): string {
  const value = urn ?? '';
  if (!isOwnershipChainUrn(value)) return MOVE_HINT_GRAMMAR_V2;

  const lastSep = value.lastIndexOf(CHAIN_SEP);
  return `${value.slice(0, lastSep + CHAIN_SEP.length)}<loc>`;
}
