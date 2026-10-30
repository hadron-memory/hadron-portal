/**
 * #1131 — the per-asset public-link switch, as the portal sees it.
 *
 * The portal decides NOTHING here. Whether a reader may switch the link
 * (`canManagePublicLink`) and whether the deployment serves links at all
 * (`publicLinkAvailable`) are the server's answers (hrn:node:hadronmemory.com:specs:cor:acl:010:01), carried
 * on every Asset projection; this module only asks for both to be exactly
 * `true`.
 *
 * It does NOT consult `publicUrl`. A null URL is not proof the switch is off
 * (it is also null with no canonical origin or a non-CLEAN asset) and not proof
 * the deployment gate is closed — reading it as either would hide a control the
 * server grants or show one it refuses.
 */
import { tick } from 'svelte';
import type { AssetSummary } from '$lib/api/assetUpload';

export type PublicLinkSignals = Pick<
  AssetSummary,
  'canManagePublicLink' | 'publicLinkAvailable' | 'publicLinkEnabled'
>;

/**
 * Show the switch only when the server says this reader may use it AND the
 * deployment serves links. Strict `=== true`: an absent field (a stale cache, an
 * older server) hides the control rather than offering one nobody vouched for.
 */
export function canSwitchPublicLink(a: Partial<PublicLinkSignals>): boolean {
  return a.canManagePublicLink === true && a.publicLinkAvailable === true;
}

/**
 * When the confirmation closes, the button that had focus is removed and focus
 * falls to `<body>` (Uma UX P2, portal#1374). Once the DOM has settled, hand focus
 * back to the control that opened the panel. Only when focus was actually lost:
 * a reader who has moved focus somewhere else keeps it there.
 */
export async function returnFocusAfterClose(target: () => HTMLElement | null | undefined): Promise<void> {
  await tick();
  const active = document.activeElement;
  if (active && active !== document.body) return;
  target()?.focus();
}
