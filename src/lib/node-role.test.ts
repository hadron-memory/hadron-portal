/** #921 — what the node metadata form sends for Node.role. */
import { describe, expect, it } from 'vitest';
import { ROLE_SUGGESTIONS, roleUpdate } from './node-role';

describe('roleUpdate — omit, clear, or set', () => {
  it('OMITS an untouched field, set or unset, so a save never clears or overwrites it', () => {
    expect(roleUpdate('spec.feature', 'spec.feature')).toBeUndefined();
    expect(roleUpdate('', '')).toBeUndefined();
    // Stored with whitespace the user never touched: still omitted, not "fixed".
    expect(roleUpdate(' odd ', ' odd ')).toBeUndefined();
  });

  it('CLEARS a role the user emptied, with an explicit null', () => {
    expect(roleUpdate('', 'review')).toBeNull();
    expect(roleUpdate('   ', 'review')).toBeNull();
  });

  it('SETS the role as typed: trimmed, never lowercased, dotted and custom kept', () => {
    expect(roleUpdate('spec.feature', 'spec')).toBe('spec.feature');
    expect(roleUpdate('  Spec.Feature ', '')).toBe('Spec.Feature');
    expect(roleUpdate('my-team.custom.thing', 'review')).toBe('my-team.custom.thing');
  });

  it('treats whitespace added around an unchanged role as no change', () => {
    expect(roleUpdate(' spec ', 'spec')).toBeUndefined();
    expect(roleUpdate('   ', '')).toBeUndefined();
  });

  it('suggests common roles without closing the vocabulary', () => {
    expect(ROLE_SUGGESTIONS).toEqual(['spec', 'review']);
  });
});
