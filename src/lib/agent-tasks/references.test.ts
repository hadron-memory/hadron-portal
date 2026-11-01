/**
 * portal#1575 — a task's typed references (hadron-server#2649/#3112;
 * hrn:node:hadronmemory.com:specs:cor:agt:050:01, :09): the pure helpers the
 * detail view and the edit form share.
 *
 * Stored strings are untrusted (the §10 note on #3112): a target and a label
 * are stored exactly as given, bidi and format characters, userinfo and
 * upper-case schemes included. So the display neutralizes Unicode format
 * characters, the `href` stays the stored string exactly, only http(s) is ever
 * a link, and a TASK reference links only inside its own App.
 */
import { describe, expect, it } from 'vitest';
import { parseHandle, taskReferenceTarget } from './handle';
import {
  isNodeUrn,
  neutralizeFormatChars,
  readReferences,
  referenceKindLabel,
  referenceLink,
  sameReferences,
} from './references';

const app = { id: 'app-1', urn: 'hrn:app:acme.com:team' };

describe('neutralizeFormatChars (acceptance 2)', () => {
  // Every \p{Cf} range the issue names, one code point at a time.
  const named = [
    ...Array.from({ length: 5 }, (_, i) => 0x202a + i), // LRE..RLO
    ...Array.from({ length: 4 }, (_, i) => 0x2066 + i), // LRI..PDI
    ...Array.from({ length: 5 }, (_, i) => 0x200b + i), // ZWSP..RLM
  ];
  it.each(named.map((cp) => [cp.toString(16).toUpperCase().padStart(4, '0'), cp]))('U+%s is shown, not obeyed', (hex, cp) => {
    const out = neutralizeFormatChars(`a${String.fromCodePoint(cp as number)}b`);
    expect(out).not.toMatch(/\p{Cf}/u);
    expect(out).toBe(`a[U+${hex}]b`);
  });

  it('a right-to-left override cannot reverse what follows it', () => {
    const shown = neutralizeFormatChars('https://example.com/‮gpj.exe');
    expect(shown).toBe('https://example.com/[U+202E]gpj.exe');
  });

  it('any other format character (BOM, soft hyphen, Arabic letter mark) is neutralized too', () => {
    expect(neutralizeFormatChars('﻿x­y؜z')).toBe('[U+FEFF]x[U+00AD]y[U+061C]z');
  });

  it.each([
    ['Latin', 'Fix the login page (v2)'],
    ['Cyrillic', 'Исправить страницу входа'],
    ['Greek', 'Διόρθωση σελίδας'],
    ['Arabic', 'إصلاح صفحة الدخول'],
    ['Hebrew', 'תיקון דף הכניסה'],
    ['CJK', 'ログインページを修正する'],
    ['Devanagari', 'लॉगिन पृष्ठ ठीक करें'],
    ['emoji without joiners', 'Ship it 🚀'],
    ['a URL', 'https://github.com/hadron-memory/hadron-portal/issues/1575'],
  ])('ordinary %s text is unchanged', (_name, text) => {
    expect(neutralizeFormatChars(text)).toBe(text);
  });
});

describe('taskReferenceTarget (acceptance 3)', () => {
  it('builds hrn:agenttask:<app key>:<handle> from the App’s own URN', () => {
    expect(taskReferenceTarget(app.urn, 'AT1.2')).toBe('hrn:agenttask:acme.com:team:AT1.2');
  });

  it('round-trips through parseHandle: same handle, same App key', () => {
    const target = taskReferenceTarget('hrn:app:hadronmemory.com:hadron-dev-team', 'AT0.3898')!;
    expect(parseHandle(target)).toEqual({ handle: 'AT0.3898', appUrn: 'hadronmemory.com:hadron-dev-team' });
  });

  it.each([
    ['not an App URN', 'hrn:node:acme.com:team:x', 'AT1'],
    ['an unparseable App URN', 'team', 'AT1'],
    ['not a handle', 'hrn:app:acme.com:team', 'some-id'],
    ['a qualified handle', 'hrn:app:acme.com:team', 'hrn:agenttask:acme.com:team:AT1'],
  ])('builds nothing from %s', (_name, appUrn, handle) => {
    expect(taskReferenceTarget(appUrn, handle)).toBeNull();
  });
});

describe('isNodeUrn (acceptance 5, the NODE field’s shape check)', () => {
  it.each(['hrn:node:acme.com:team:findings:x', 'hrn:node:hadronmemory.com:hadron-portal:hadron-portal'])('accepts %s', (v) => {
    expect(isNodeUrn(v)).toBe(true);
  });
  it.each([
    '',
    'hrn:mem:acme.com:team',
    'hrn:agenttask:acme.com:team:AT1',
    'acme.com:team:x',
    'https://hadronmemory.com/app/u/hrn:node:acme.com:team:x',
    ' hrn:node:acme.com:team:x',
    'hrn:node:acme.com:team:x ',
    'hrn:node:acme.com:team:‮x',
  ])('refuses %j', (v) => {
    expect(isNodeUrn(v)).toBe(false);
  });
});

describe('referenceLink (acceptance 1, the one link rule)', () => {
  const ref = (kind: string, target: string) => ({ kind, target, label: null }) as never;

  it('an http(s) target is an external link whose href is the stored string exactly', () => {
    for (const target of ['https://github.com/o/r/issues/1', 'http://x.test/a?b=c#d', 'HTTPS://GITHUB.COM/o/r/pull/2']) {
      expect(referenceLink(ref('URL', target), app)).toEqual({ kind: 'href', href: target, external: true });
    }
  });

  it('a userinfo target is a link to exactly what is stored, nothing rewritten', () => {
    const target = 'https://evil.com@github.com/o/r/pull/2';
    expect(referenceLink(ref('PULL_REQUEST', target), app)).toEqual({ kind: 'href', href: target, external: true });
  });

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', '//evil.test/x', 'example.com'])('%s is never a link', (target) => {
    expect(referenceLink(ref('URL', target), app)).toEqual({ kind: 'text' });
  });

  it('a node URN is a resolver chip', () => {
    expect(referenceLink(ref('NODE', 'hrn:node:acme.com:team:x'), app)).toEqual({ kind: 'urn', urn: 'hrn:node:acme.com:team:x', linked: true });
  });

  it('a URN carrying a format character is text, never a chip', () => {
    expect(referenceLink(ref('NODE', 'hrn:node:acme.com:team:‮x'), app)).toEqual({ kind: 'text' });
  });

  describe('TASK: decided by its kind, before the URL/URN rule', () => {
    it('a same-App reference links to the task page by its handle', () => {
      expect(referenceLink(ref('TASK', 'hrn:agenttask:acme.com:team:AT1.2'), app)).toEqual({ kind: 'href', href: '/app/apps/app-1/tasks/AT1.2', external: false });
    });
    it('the App key compares without case, as the route does', () => {
      expect(referenceLink(ref('TASK', 'hrn:agenttask:ACME.com:Team:at1.2'), app)).toEqual({ kind: 'href', href: '/app/apps/app-1/tasks/AT1.2', external: false });
    });
    it.each([
      ['another App', 'hrn:agenttask:acme.com:other:AT1.2'],
      ['an id, not a handle', 'hrn:agenttask:acme.com:team:01a1b2c3'],
      ['a bare handle', 'AT1.2'],
      ['a URL', 'https://github.com/o/r/issues/1'],
    ])('%s is text with no link', (_name, target) => {
      expect(referenceLink(ref('TASK', target), app)).toEqual({ kind: 'text' });
    });
  });

  it('an hrn:agenttask target under any other kind is text, never /app/u', () => {
    for (const kind of ['NODE', 'URL', 'ISSUE']) {
      expect(referenceLink(ref(kind, 'hrn:agenttask:acme.com:team:AT1.2'), app)).toEqual({ kind: 'text' });
    }
  });
});

describe('referenceKindLabel', () => {
  it.each([['ISSUE', 'Issue'], ['PULL_REQUEST', 'Pull request'], ['NODE', 'Node'], ['TASK', 'Task'], ['URL', 'Link']])('%s reads %s', (kind, label) => {
    expect(referenceKindLabel(kind as never)).toBe(label);
  });
});

describe('readReferences: what a form posts', () => {
  it('reads the posted list in order, keeping each target exactly', () => {
    const list = [
      { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'the bug' },
      { kind: 'NODE', target: 'hrn:node:acme.com:team:x', label: null },
      { kind: 'URL', target: 'https://example.com/‮x', label: '' },
    ];
    expect(readReferences(JSON.stringify(list))).toEqual([
      { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'the bug' },
      { kind: 'NODE', target: 'hrn:node:acme.com:team:x', label: null },
      { kind: 'URL', target: 'https://example.com/‮x', label: null },
    ]);
  });

  it.each([
    ['not JSON', '{'],
    ['not a list', '{"kind":"URL"}'],
    ['an unknown kind', '[{"kind":"FILE","target":"x"}]'],
    ['no target', '[{"kind":"URL"}]'],
    ['a non-string label', '[{"kind":"URL","target":"https://x.test","label":3}]'],
    ['nothing posted', null],
  ])('%s is unreadable (null), never a silent empty list', (_name, raw) => {
    expect(readReferences(raw)).toBeNull();
  });

  it('an empty list is an empty list', () => {
    expect(readReferences('[]')).toEqual([]);
  });
});

describe('sameReferences', () => {
  const a = { kind: 'URL', target: 'https://a.test', label: null } as const;
  const b = { kind: 'ISSUE', target: 'https://b.test', label: 'b' } as const;
  it('order matters: a reorder is a change', () => {
    expect(sameReferences([a, b], [a, b])).toBe(true);
    expect(sameReferences([a, b], [b, a])).toBe(false);
  });
  it('a changed label or kind is a change', () => {
    expect(sameReferences([b], [{ ...b, label: null }])).toBe(false);
    expect(sameReferences([a], [{ ...a, kind: 'ISSUE' }])).toBe(false);
  });
});
