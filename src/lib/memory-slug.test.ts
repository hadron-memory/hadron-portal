/** #2653 — the portal's copy of the server's rule (cor:dmo:060:20): personal or private WITH an App keeps its slug. */
import { describe, expect, it } from 'vitest';
import { memorySlugIsFixed } from './memory-slug';

describe('memorySlugIsFixed', () => {
  it.each([
    ['personal', 'app-1', true],
    ['private', 'app-1', true],
    ['personal', null, false],
    ['private', undefined, false],
    ['knowledge', 'app-1', false],
    ['group', 'app-1', false],
    ['system', 'app-1', false],
    ['app', 'app-1', false],
  ])('%s with appId %s is %s', (cls, appId, expected) => {
    expect(memorySlugIsFixed({ class: cls as never, appId })).toBe(expected);
  });
});
