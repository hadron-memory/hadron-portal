import { describe, expect, it } from 'vitest';
import {
  isRepeatedFindingPage,
  neutralizeFindingText,
  parseTaskFindingPage,
  parseTaskFindingsPayload,
  TASK_FINDINGS_PAGE_SIZE,
  type AgentTaskFinding,
  type AgentTaskFindingPage,
} from './findings';

const finding = (id = 'F1', text = 'A literal finding'): AgentTaskFinding => ({ id, severity: 'P2', text });
const page = (over: Partial<AgentTaskFindingPage> = {}): AgentTaskFindingPage => ({
  taskId: 'task-A', offset: 0, items: [finding()], total: 1, hasMore: false, ...over,
});

describe('immutable task finding pages (portal#1637)', () => {
  it('accepts the full legal shape and keeps all 2000 Unicode code points', () => {
    const text = ('a👩‍👩‍👧‍👦é\n').repeat(250).slice(0, 2000);
    const raw = { items: [{ id: 'F_1-x', severity: 'note', text }], total: 1, hasMore: false };
    expect(parseTaskFindingPage(raw, { taskId: 'task-A', offset: 0 })).toEqual(page({
      items: [{ id: 'F_1-x', severity: 'note', text }], total: 1,
    }));
    expect([...text].length).toBeLessThanOrEqual(2000);
    expect(parseTaskFindingPage(raw, { taskId: 'task-A', offset: 0 })?.items[0]?.text).toBe(text);
  });

  it('accepts a valid empty page beyond the total, preserving total and hasMore', () => {
    expect(parseTaskFindingPage({ items: [], total: 21, hasMore: false }, { taskId: 'task-A', offset: 40 }))
      .toEqual(page({ offset: 40, items: [], total: 21 }));
  });

  it('accepts a short page with hasMore=true: shortness is not end-of-data', () => {
    expect(parseTaskFindingPage({ items: [finding()], total: 40, hasMore: true }, { taskId: 'task-A', offset: 20 }))
      .toEqual(page({ offset: 20, total: 40, hasMore: true }));
  });

  it.each([
    ['null', null],
    ['missing items', { total: 0, hasMore: false }],
    ['null items', { items: null, total: 0, hasMore: false }],
    ['null item', { items: [null], total: 1, hasMore: false }],
    ['missing id', { items: [{ severity: 'P1', text: 'x' }], total: 1, hasMore: false }],
    ['bad id', { items: [{ id: '../secret', severity: 'P1', text: 'x' }], total: 1, hasMore: false }],
    ['unknown severity', { items: [{ id: 'F1', severity: 'blocking', text: 'x' }], total: 1, hasMore: false }],
    ['null text', { items: [{ id: 'F1', severity: 'P1', text: null }], total: 1, hasMore: false }],
    ['negative total', { items: [], total: -1, hasMore: false }],
    ['fractional total', { items: [], total: 1.5, hasMore: false }],
    ['unsafe total', { items: [], total: Number.MAX_SAFE_INTEGER + 1, hasMore: false }],
    ['non-boolean hasMore', { items: [], total: 0, hasMore: 'no' }],
    ['duplicate ids', { items: [finding('F1'), finding('F1')], total: 2, hasMore: false }],
    ['too many served rows', { items: Array.from({ length: TASK_FINDINGS_PAGE_SIZE + 1 }, (_, i) => finding(`F${i}`)), total: 21, hasMore: false }],
    ['overlong text', { items: [finding('F1', '👩‍👩‍👧‍👦'.repeat(2001))], total: 1, hasMore: false }],
    ['empty continuation', { items: [], total: 20, hasMore: true }],
    ['terminal page that strands reported rows', { items: [], total: 20, hasMore: false }],
    ['short terminal page that strands reported rows', { items: [finding()], total: 2, hasMore: false }],
    ['rows served beyond the total', { items: [finding()], total: 0, hasMore: false }],
  ])('refuses %s instead of defaulting it to empty', (_label, raw) => {
    expect(parseTaskFindingPage(raw, { taskId: 'task-A', offset: 0 })).toBeNull();
  });

  it('refuses a page for another task or requested offset', () => {
    const raw = { items: [finding()], total: 1, hasMore: false };
    expect(parseTaskFindingsPayload({ kind: 'page', value: { ...raw, taskId: 'task-B', offset: 0 } }, { taskId: 'task-A', offset: 0 })).toBeNull();
    expect(parseTaskFindingsPayload({ kind: 'page', value: { ...raw, taskId: 'task-A', offset: 20 } }, { taskId: 'task-A', offset: 0 })).toBeNull();
  });

  it('validates every typed read branch, never laundering a malformed answer into failed/empty', () => {
    const id = { taskId: 'task-A', offset: 0 };
    expect(parseTaskFindingsPayload({ kind: 'no-result' }, id)).toEqual({ kind: 'no-result' });
    expect(parseTaskFindingsPayload({ kind: 'unavailable' }, id)).toEqual({ kind: 'unavailable' });
    expect(parseTaskFindingsPayload({ kind: 'failed' }, id)).toEqual({ kind: 'failed' });
    expect(parseTaskFindingsPayload({ kind: 'page', value: { items: [], total: 0, hasMore: false } }, id))
      .toEqual({ kind: 'page', value: page({ items: [], total: 0 }) });
    expect(parseTaskFindingsPayload({ kind: 'empty' }, id)).toBeNull();
    expect(parseTaskFindingsPayload(null, id)).toBeNull();
  });

  it('detects a repeated next page rather than advancing forever', () => {
    const current = page({ items: [finding('F1'), finding('F2')], total: 4, hasMore: true });
    expect(isRepeatedFindingPage(page({ offset: 2, items: [finding('F1'), finding('F2')], total: 4, hasMore: true }), current)).toBe(true);
    expect(isRepeatedFindingPage(page({ offset: 2, items: [finding('F3'), finding('F4')], total: 4, hasMore: false }), current)).toBe(false);
  });
});

describe('literal finding text', () => {
  it('shows ESC, CR and bidi controls as code-point markers while preserving LF and TAB', () => {
    expect(neutralizeFindingText('a\u001bb\u0007c\r\nd\te‮f⁩g\u007fh'))
      .toBe('a[U+001B]b[U+0007]c[U+000D]\nd\te[U+202E]f[U+2069]g[U+007F]h');
  });

  it('reveals C1 controls and every known blank-looking character', () => {
    expect(neutralizeFindingText('\u0085\u009Fᅟᅠㅤﾠ⠀͏'))
      .toBe('[U+0085][U+009F][U+115F][U+1160][U+3164][U+FFA0][U+2800][U+034F]');
  });

  it('preserves emoji joiners, variation selectors, combining marks and all remaining text', () => {
    const text = '👩‍👩‍👧‍👦 ❤️ é a̐éö̲';
    expect(neutralizeFindingText(text)).toBe(text);
  });

  it('does not strip every format character, but makes invisible/bidi formatting visible', () => {
    expect(neutralizeFindingText('a‍b​c‎d️e')).toBe('a‍b[U+200B]c[U+200E]d️e');
  });

  it('leaves HTML, Markdown, javascript and fake-link payloads literal', () => {
    const text = '<img src=x onerror=alert(1)> <script>alert(2)</script> [click](javascript:alert(3)) https://example.test';
    expect(neutralizeFindingText(text)).toBe(text);
  });
});
