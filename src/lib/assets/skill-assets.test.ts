/**
 * #774 — the two Claude skill bodies, now `.md` assets rather than inline
 * template literals.
 *
 * The hazard they were the second instance of (#751): a backtick inside a
 * multi-line template literal TERMINATES the string, and esbuild then reports a
 * nonsense error on the following line. These bodies are Markdown, where a tool
 * name is naturally written in backticks, and they avoided it by using
 * `**bold**` — a convention nothing enforced and no future editor had reason to
 * know.
 *
 * So the load-bearing assertion here is the strange-looking one: the shipped
 * bodies CONTAIN BACKTICKS. That content could not exist while they were
 * inline, which makes it proof the hazard is gone rather than relocated.
 */
import { describe, expect, it } from 'vitest';
import { fill } from '$lib/i18n/t';
import skillGetStarted from './skill-get-started.md?raw';
import skillSearch from './skill-search.md?raw';

describe('the shipped skill bodies', () => {
  it.each([
    ['get-started', skillGetStarted],
    ['search', skillSearch],
  ])('%s uses backticks — the thing that could not be written inline', (_name, body) => {
    expect(body).toContain('`hadron_find_nodes`');
  });

  // A `.md` file is not a template literal, so a `${…}` in one would be shipped
  // verbatim into the user's SKILL.md rather than substituted. Its absence is
  // what says the move was completed rather than half-done.
  it.each([
    ['get-started', skillGetStarted],
    ['search', skillSearch],
  ])('%s carries no JS interpolation left over from the literal', (_name, body) => {
    expect(body).not.toContain('${');
  });

  // Claude reads the frontmatter; a body that lost its delimiters on the way
  // out of the component would ship as a skill that does not load, and nothing
  // else here would notice.
  it('keeps valid frontmatter on both', () => {
    expect(skillGetStarted).toMatch(/^---\nname: get-started\ndescription: .+\n---\n/);
    expect(skillSearch).toMatch(/^---\nname: search\ndescription: .+\n---\n/);
  });

  it('names the app through a placeholder rather than hard-coding one', () => {
    expect(skillGetStarted).toContain('{appName}');
    expect(skillSearch).not.toContain('{appName}');
  });
});

describe('substituting the app name', () => {
  it('fills the placeholder', () => {
    const out = fill(skillGetStarted, { appName: 'Acme' });
    expect(out).toContain('connected to Hadron app "Acme"');
    expect(out).not.toContain('{appName}');
  });

  // An App name is user-chosen, so it reaches this as an unrestricted string.
  // `.replace('{appName}', name)` would expand `$&` out of it (#817) — this is
  // the same class of defect, on a file the user then downloads.
  it('does not expand $& out of an app name', () => {
    const out = fill(skillGetStarted, { appName: 'Acme $& Co' });
    expect(out).toContain('connected to Hadron app "Acme $& Co"');
    expect(out).not.toContain('{appName}');
  });
});
