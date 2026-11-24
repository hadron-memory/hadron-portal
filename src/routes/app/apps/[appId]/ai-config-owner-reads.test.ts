/**
 * portal#2567: the AI tab's gate reads `tabData.canManageApp`, so the tab's first screen must ask for the
 * `canManage` read group and that group must carry that exact key. The page tests inject the field; this is
 * the pin that the loader is asked for it.
 */
import { describe, expect, it } from 'vitest';
import { READ_GROUP_KEYS, TAB_PAYLOAD_KEYS, TAB_READS } from './first-screen';

describe('the AI tab reads the manage flag it renders (portal#2567)', () => {
  it('the tab asks for the canManage group, and that group carries canManageApp', () => {
    expect(TAB_READS['ai-configs']).toContain('canManage');
    expect(READ_GROUP_KEYS.canManage).toContain('canManageApp');
  });
  it('canManageApp is a tab-payload key, so a first-show fetch of the tab delivers it', () => {
    expect(TAB_PAYLOAD_KEYS.has('canManageApp')).toBe(true);
  });
});
