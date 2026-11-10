// Shared, single-source matcher for "a saved-view storage error is rendered
// here". The saved-view UI surfaces failures exactly two ways (ViewTabs.run):
// a ViewStorageError renders `e.message` verbatim, and any other throw renders
// the generic catch-all `saved-views.error.update`. This regex is BUILT from
// the ViewStorageError message family exported by $lib/table/viewStore plus
// that catch-all, so a reworded message rides along automatically instead of
// silently emptying every `not.toMatch` pin built on this. The client-lane
// positive control (AppMemories.client.test.ts: "renders the storage-error
// family text when saving a view fails") is what proves the render path still
// surfaces these strings as text — without it a `not.toMatch` here can assert
// nothing while staying green.
import { viewStorageErrorMessages } from '$lib/table/viewStore';
import { savedViewsStrings } from '$lib/i18n/saved-views-strings';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches any text the saved-view UI renders for a failed storage operation. */
export const viewStorageErrorText: RegExp = new RegExp(
  [savedViewsStrings.updateError(), ...Object.values(viewStorageErrorMessages)]
    .map(escapeRe)
    .join('|'),
);
