import { describe, expect, it } from 'vitest';
import { servedNowText } from './boot-install';
import { compileRefusalText } from './boot-compile';
const worker = { level: 'worker' as const, worker: 'w', app: 'a', agent: 'g' };
const app = { level: 'app' as const, app: 'a', agent: 'g' };
describe('served now is only a viewer read', () => {
  it.each(['BOOT_PROMPT_NOT_APPROVED', 'BOOT_PROMPT_NOT_SET', 'BOOT_PROMPT_TARGET_DELETED', 'BOOT_PROMPT_NOT_SIGNED'])('renders refusal %s without a fallback revision', refusal => {
    const text = servedNowText({ refusal, served: null }, app, 'c');
    expect(text).toContain('Right now it would be refused');
    expect(text).not.toContain('would get');
  });
  it.each(['AGENT', 'APP_AGENT', 'WORKER'] as const)('names only the serving level %s, never another node id', pointerLevel => {
    const text = servedNowText({ refusal: null, served: { pointerLevel, compiledNodeId: 'private-node-id', servedRevSeq: 7 } }, worker, 'c');
    expect(text).toContain('next bind would get revision 7');
    expect(text).not.toContain('private-node-id');
    expect(text).not.toContain('this prompt');
  });
  it('names this node only when the resolved identity matches', () => {
    expect(servedNowText({ refusal: null, served: { pointerLevel: 'APP_AGENT', compiledNodeId: 'c', servedRevSeq: 7 } }, app, 'c')).toContain('without its own prompt, a chat or a run started now would get revision 7 of this prompt');
    expect(servedNowText(null, worker, 'c')).toBe('Couldn’t read what would be served now.');
  });
});
describe('portal#1754 servedNowText looks names up as own properties only', () => {
  const unknown = 'Couldn’t read what would be served now.';
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('a refusal named %s answers the serve-unknown text', name => {
    expect(servedNowText({ refusal: name as never, served: null }, app, 'c')).toBe(unknown);
  });
  it.each(['constructor', '__proto__', 'toString'])('a pointer level named %s answers the serve-unknown text', name => {
    expect(servedNowText({ refusal: null, served: { pointerLevel: name as never, compiledNodeId: 'x', servedRevSeq: 7 } }, app, 'c')).toBe(unknown);
  });
});
describe('portal#1754 the own-property lookup keeps the legitimate copy', () => {
  it('a real refusal still names its reason', () => {
    expect(servedNowText({ refusal: 'BOOT_PROMPT_NOT_SIGNED', served: null }, app, 'c')).toContain('Right now it would be refused: no signed revision is available');
  });
  it('a valid pointer level still renders the served copy', () => {
    expect(servedNowText({ refusal: null, served: { pointerLevel: 'WORKER', compiledNodeId: 'other', servedRevSeq: 7 } }, worker, 'c')).toContain('revision 7 of the worker’s own prompt');
  });
  it('this node needs no pointer level at all: a junk one still says "this prompt"', () => {
    expect(servedNowText({ refusal: null, served: { pointerLevel: 'constructor' as never, compiledNodeId: 'c', servedRevSeq: 7 } }, app, 'c')).toContain('of this prompt');
  });
});
describe('all typed compile refusals', () => {
  it.each(['BOOT_PROMPT_COMPILE_NOT_PERMITTED', 'BOOT_PROMPT_TARGET_RETIRED', 'BOOT_PROMPT_NO_SOURCE', 'BOOT_PROMPT_SOURCE_INVALID', 'BOOT_PROMPT_NODE_TYPE', 'BOOT_PROMPT_GRANT_REQUIRED', 'BOOT_PROMPT_COMPILE_LIMIT_EXCEEDED', ...['MALFORMED', 'UNAVAILABLE', 'RETIRED', 'REVISION_UNAVAILABLE', 'SOURCE_DISALLOWED', 'CYCLE', 'TOO_DEEP'].map(tail => `BOOT_PROMPT_INCLUDE_${tail}`)])('%s is fixed copy with no target leak', code => {
    for (const level of ['App', 'worker'] as const) {
      const text = compileRefusalText(code, 12, undefined, level);
      expect(text).toContain('Nothing changed.');
      expect(text).not.toMatch(/hrn:|you don’t manage|you don't manage/);
      if (code.startsWith('BOOT_PROMPT_INCLUDE_')) expect(text).toContain('character 12');
    }
  });
});
