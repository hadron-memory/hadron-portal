/**
 * #909 — the plugin version is the CLI's recipe, byte for byte.
 *
 * The golden values were produced by the CLI's OWN `buildArtifact`
 * (hadron-cli `c9e9162`, #707) on these exact inputs, not by this port — so a
 * drift in either producer fails here rather than as two plugins that disagree
 * about whether they changed. The CLI's description for an unscoped build is
 * "Task skills exported from Hadron".
 */
import { describe, expect, it } from 'vitest';
import { pluginVersion } from './plugin-version';

const CLI_DESC = 'Task skills exported from Hadron';
const BODY = '---\nname: drive-pr-home\ndescription: x\n---\n\nbody\n';

describe('pluginVersion — the same answer as hadron-cli buildArtifact', () => {
  it('matches the CLI with no skills', () => {
    expect(pluginVersion('acme-corp-skills', CLI_DESC, {})).toBe('0.0.0-h0e136dd8523e');
  });

  it('matches the CLI with one skill', () => {
    expect(pluginVersion('acme-corp-skills', CLI_DESC, { 'drive-pr-home': BODY })).toBe('0.0.0-h662a7be8ddc4');
  });

  it('matches the CLI on multibyte bodies, an empty body and name order', () => {
    // Byte lengths, not UTF-16 lengths ("é", "ö" are 2 bytes, "🚀" is 4), and
    // the skills handed over OUT of order — the recipe sorts them.
    const skills = { zeta: 'Z', alpha: 'héllo 🚀 wörld\n', 'mid-9': '' };
    expect(pluginVersion('acme-corp-skills', CLI_DESC, skills)).toBe('0.0.0-h26ccd61b694c');
  });

  it('orders names by bytes, as Go does, not by locale', () => {
    // Locale order is a < é < Z; byte order is Z < a < é. No valid skill name
    // can tell the two apart, but the recipe is defined on bytes.
    expect(pluginVersion('acme-corp-skills', CLI_DESC, { a: '1', Z: '2', é: '3' })).toBe('0.0.0-hb87027153f22');
  });
});

describe('pluginVersion — stable content, stable version; changed content, changed version', () => {
  const base = { a: 'one\n', b: 'two\n' };
  const v = pluginVersion('acme-skills', 'd', base);

  it('is valid semver with an alphanumeric pre-release', () => {
    expect(v).toMatch(/^0\.0\.0-h[0-9a-f]{12}$/);
  });

  it('does not depend on the order the skills arrive in', () => {
    expect(pluginVersion('acme-skills', 'd', { b: 'two\n', a: 'one\n' })).toBe(v);
  });

  it.each([
    ['a body', () => pluginVersion('acme-skills', 'd', { a: 'one!\n', b: 'two\n' })],
    ['a skill name', () => pluginVersion('acme-skills', 'd', { a2: 'one\n', b: 'two\n' })],
    ['an added skill', () => pluginVersion('acme-skills', 'd', { ...base, c: '' })],
    ['a removed skill', () => pluginVersion('acme-skills', 'd', { a: 'one\n' })],
    ['the plugin name', () => pluginVersion('acme2-skills', 'd', base)],
    ['the description', () => pluginVersion('acme-skills', 'e', base)],
  ])('changes when %s changes', (_what, other) => {
    expect(other()).not.toBe(v);
  });

  it('cannot be fooled by moving bytes between a name and its body', () => {
    // Unprefixed, "ab"+"c" and "a"+"bc" would hash alike.
    expect(pluginVersion('p', 'd', { ab: 'c' })).not.toBe(pluginVersion('p', 'd', { a: 'bc' }));
  });
});
