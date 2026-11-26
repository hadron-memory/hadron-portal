import { describe, expect, it } from 'vitest';
import { ASSET_TABS, DEFAULT_ASSET_TAB, assetQueryArgs, parseAssetTab } from './tabs';

describe('parseAssetTab', () => {
  it('accepts every declared tab', () => {
    for (const tab of ASSET_TABS) expect(parseAssetTab(tab)).toBe(tab);
  });

  it('falls back for an unrecognised or absent value', () => {
    // `?tab=` is untrusted input; a bad value must not reach the query layer.
    expect(parseAssetTab('nonsense')).toBe(DEFAULT_ASSET_TAB);
    expect(parseAssetTab(null)).toBe(DEFAULT_ASSET_TAB);
    expect(parseAssetTab(undefined)).toBe(DEFAULT_ASSET_TAB);
    expect(parseAssetTab('')).toBe(DEFAULT_ASSET_TAB);
  });

  it('is case-sensitive rather than guessing', () => {
    expect(parseAssetTab('Mine')).toBe(DEFAULT_ASSET_TAB);
  });
});

describe('assetQueryArgs', () => {
  it('narrows "mine" to the caller’s own uploads', () => {
    expect(assetQueryArgs('mine', 'org-1')).toEqual({ filter: { mine: true } });
  });

  it('sends nothing for "available" — the default scope IS the accessible set', () => {
    // Passing a filter here would narrow, never widen, so the empty object is the
    // whole accessible set by design.
    expect(assetQueryArgs('available', 'org-1')).toEqual({});
  });

  it('scopes "org" to the active org', () => {
    expect(assetQueryArgs('org', 'org-1')).toEqual({ orgRef: 'org-1' });
    // hadron-server#5081: the old name would be ignored and return an unscoped list.
    expect(assetQueryArgs('org', 'org-1')).not.toHaveProperty('orgId');
  });

  it('returns null for "org" with no active org — never the default scope', () => {
    // THE important case. Omitting orgRef would return every asset the caller can
    // reach and let the UI label it "this organization's" — the relabelling trap
    // hrn:node:hadronmemory.com:hadron-server:conventions:multi-ref-scope-args calls out for an empty memoryRefs list.
    expect(assetQueryArgs('org', null)).toBeNull();
    expect(assetQueryArgs('org', undefined)).toBeNull();
    expect(assetQueryArgs('org', '')).toBeNull();
  });

  it('never returns an orgRef for the non-org tabs', () => {
    // A stray orgRef would silently narrow "My files" to one org.
    for (const tab of ['mine', 'available'] as const) {
      expect(assetQueryArgs(tab, 'org-1')).not.toHaveProperty('orgRef');
    }
  });

  it('the "mine" filter does not also pin an org', () => {
    expect(assetQueryArgs('mine', 'org-1')).toEqual({ filter: { mine: true } });
  });
});
