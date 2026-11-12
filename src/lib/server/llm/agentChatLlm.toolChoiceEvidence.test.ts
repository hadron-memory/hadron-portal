/**
 * #2037: the Anthropic forced-tool-choice set agrees with the provider docs.
 *
 * DOCS is a snapshot of two Anthropic pages, read 2026-11-12, and is a test
 * oracle only: production never reads it. The one predicate is
 * `usesAutoToolChoice` (see the evidence block beside its list). When the docs
 * change, update this snapshot and the list together.
 *
 * - Restriction row, "Forcing tool use":
 *   https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
 * - API ids: https://platform.claude.com/docs/en/models/overview
 *   ("API ID" and "API alias" cells are identical for these models; from the
 *   4.6 generation on the dateless id is the snapshot, so no dated form exists).
 */
import { describe, expect, it } from 'vitest';
import { usesAutoToolChoice } from './agentChatLlm.js';

const DOCS = {
  /** Named in the restriction row; `apiId` null where the models table gives none. */
  rejectsForcedChoice: [
    { model: 'Claude Fable 5.2', apiId: 'claude-fable-5-2' },
    { model: 'Claude Mythos 5.2', apiId: null },
    { model: 'Claude Opus 5.5', apiId: 'claude-opus-5-5' },
    { model: 'Claude Sonnet 5.5', apiId: 'claude-sonnet-5-5' },
    { model: 'Claude Fable 5.1', apiId: null },
    { model: 'Claude Mythos 5.1', apiId: null },
  ],
  /** Documented ids NOT named in the restriction row: a forced choice works. */
  acceptsForcedChoice: ['claude-haiku-5-5'],
} as const;

const documented = DOCS.rejectsForcedChoice.flatMap((r) => (r.apiId ? [r.apiId] : []));

describe('the list matches the documented restriction', () => {
  it.each(documented)('documented id %s gets auto', (id) => {
    expect(usesAutoToolChoice('anthropic', id)).toBe(true);
  });

  it.each(DOCS.acceptsForcedChoice)('%s, not in the restriction row, stays forced', (id) => {
    expect(usesAutoToolChoice('anthropic', id)).toBe(false);
  });
});

describe('only documented forms are admitted (C2)', () => {
  // Id-shaped guesses for the restricted models with no documented API id.
  it.each(['claude-mythos-5-2', 'claude-fable-5-1', 'claude-mythos-5-1'])(
    'undocumented %s stays forced',
    (id) => expect(usesAutoToolChoice('anthropic', id)).toBe(false),
  );

  // Every near-miss of a documented id: dated snapshot in the pre-4.6 format,
  // suffix, `-latest` alias, case change, whitespace, prefix. None is documented.
  const nearMisses = documented.flatMap((id) => [
    `${id}-20261112`, `${id}-x`, `${id}-latest`, `${id}-v1:0`,
    id.toUpperCase(), ` ${id}`, `${id} `, `anthropic/${id}`, `anthropic.${id}`,
  ]);
  it.each(nearMisses)('near-miss %j stays forced', (id) => {
    expect(usesAutoToolChoice('anthropic', id)).toBe(false);
  });
});
