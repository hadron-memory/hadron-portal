import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import type { Comment, Discussion, DiscussionThread } from '$lib/comments';
import NodeDiscussion from './NodeDiscussion.svelte';

/**
 * portal#1014: the Discussion tab, mounted. The fetch mock answers on a
 * microtask with a plain object (no stream-backed Response), so a run under CI
 * load can't time out on body reads.
 */

const ENDPOINT = '/app/memories/mem-1/nodes/node-1/comments';

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    urn: `hrn:node:acme.com:specs:comments:${id}`,
    target: { id: 'node-1', urn: 'hrn:node:acme.com:specs:a', name: 'A', nodeType: 'info', revSeq: 3 },
    threadRootId: null,
    isTopLevel: true,
    anchorRevision: 3,
    anchorApprovalHash: 'a'.repeat(64),
    anchorIsCurrent: true,
    quote: null,
    body: 'Is §2 right?',
    state: 'OPEN',
    retracted: false,
    retractedAt: null,
    hidden: false,
    hiddenAt: null,
    resolvedAt: null,
    resolvedBy: null,
    author: { kind: 'USER', worker: null, user: { id: 'user-2', name: null, handle: 'bo', urn: null }, agent: null, app: null },
    provenanceUser: null,
    createdAt: '2026-10-05T18:00:00.000Z',
    updatedAt: null,
    revSeq: 1,
    viewerIsAuthor: false,
    ...over,
  };
}

function thread(root: Comment, mine = false): DiscussionThread {
  return { root: { ...root, viewerIsAuthor: mine }, replies: [], replyCount: 0, mine: { [root.id]: mine } };
}

const discussion = (threads: DiscussionThread[], perms = { canWrite: true, canManage: false }): Discussion => ({
  ok: true,
  threads,
  total: threads.length,
  permissions: perms,
});

function stubFetch(answer: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: answer.ok,
    status: answer.status ?? (answer.ok ? 200 : 409),
    json: async () => answer.body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buttons(target: HTMLElement): string[] {
  return [...target.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('NodeDiscussion (portal#1014)', () => {
  it('a read-only reader sees the discussion and no controls at all (cor:dmo:110:03)', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1'), true)], { canWrite: false, canManage: false }),
    });
    expect(m.target.textContent).toContain('Is §2 right?');
    expect(m.target.querySelector('textarea')).toBeNull();
    expect(buttons(m.target)).toEqual([]);
    expect(m.target.textContent).toContain('needs write access');
    m.unmount();
  });

  it('labels a thread on an older revision with that revision (cor:dmo:110:01)', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 5,
      initial: discussion([thread(comment('c1', { anchorRevision: 2 }))]),
    });
    expect(m.target.textContent).toContain('On revision 2, not the text shown here');
    m.unmount();
  });

  it('a writer who is not the author gets Reply and Resolve, not Edit or Retract', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1'), false)]),
    });
    const labels = buttons(m.target);
    expect(labels).toContain('Resolve');
    expect(labels).toContain('Reply');
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Retract');
    m.unmount();
  });

  it('posts a new thread anchored to the shown revision, then shows what the endpoint read back', async () => {
    const posted = thread(comment('c9', { body: 'Typo in §3' }), true);
    const fetchMock = stubFetch({ ok: true, body: { ok: true, discussion: discussion([posted]), summary: { openThreads: 1, resolvedThreads: 0, comments: 1 } } });
    const onsummary = vi.fn();
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: discussion([]), onsummary });

    typeInto(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!, 'Typo in §3');
    m.target.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick(10);
    flushSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(init.body))).toEqual({ op: 'create', body: 'Typo in §3', anchorRevision: 3 });
    expect(m.target.textContent).toContain('Typo in §3');
    expect(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!.value).toBe('');
    expect(onsummary).toHaveBeenCalledWith({ openThreads: 1, resolvedThreads: 0, comments: 1 });
    m.unmount();
  });

  it('a refused post keeps the draft and shows the fixed copy as an alert', async () => {
    stubFetch({ ok: false, status: 409, body: { error: 'You already have an open discussion on this node.', code: 'COMMENT_OPEN_THREAD_EXISTS' } });
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: discussion([]) });

    typeInto(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!, 'Second thought');
    m.target.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick(10);
    flushSync();

    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain('already have an open discussion');
    expect(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!.value).toBe('Second thought');
    m.unmount();
  });

  it.each(['reply', 'edit', 'resolve', 'retract', 'reopen', 'hide', 'delete'] as const)(
    'a refused %s on a removed thread keeps its alert and any draft accessible', async (op) => {
      const error = 'This comment no longer exists, or you no longer have access to it. Reload to see the current state.';
      const fetchMock = stubFetch({ ok: false, status: 404, body: { ok: false, error, discussion: discussion([]) } });
      const m = mountComponent(NodeDiscussion, {
        endpoint: ENDPOINT,
        shownRevision: 3,
        initial: discussion([thread(comment('c1', { state: op === 'reopen' ? 'RESOLVED' : 'OPEN' }), true)], { canWrite: true, canManage: true }),
      });
      const card = m.target.querySelector<HTMLElement>('[data-thread-id="c1"]')!;
      const click = (label: string) => {
        [...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!.click();
        flushSync();
      };
      const draft = 'Keep my unfinished wording';
      if (op === 'reply' || op === 'edit') {
        click(op === 'reply' ? 'Reply' : 'Edit');
        const textarea = card.querySelector<HTMLTextAreaElement>('textarea')!;
        typeInto(textarea, draft);
        textarea.form!.requestSubmit();
      } else if (op === 'retract' || op === 'hide' || op === 'delete') {
        const label = op === 'retract' ? 'Retract' : op === 'hide' ? 'Hide' : 'Delete discussion';
        click(label);
        if (op !== 'retract') {
          const input = card.querySelector<HTMLInputElement>('input')!;
          input.value = 'Moderation reason';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          flushSync();
        }
        click(label);
      } else click(op === 'resolve' ? 'Resolve' : 'Reopen');
      await tick(12);
      flushSync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(m.target.querySelector('[data-thread-id="c1"]')).toBeNull();
      expect(m.target.querySelector('[role="alert"]')?.textContent).toContain(error);
      if (op === 'reply' || op === 'edit') {
        const recovery = m.target.querySelector<HTMLTextAreaElement>('[data-testid="unavailable-draft"]');
        expect(recovery?.value).toBe(draft);
        expect(recovery?.readOnly).toBe(true);
      }
      m.unmount();
    },
  );

  it('a worker is the author, with its URN; the user who bound it shows only as provenance (cor:dmo:110:03)', () => {
    const byWorker = comment('c1', {
      author: { kind: 'WORKER', worker: { id: 'w1', name: 'Dara', handle: null, urn: 'hrn:worker:acme.com:team:dara' }, user: null, agent: null, app: null },
      provenanceUser: { id: 'u9', name: null, handle: 'binder', urn: null },
    });
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: discussion([thread(byWorker)]) });
    const headerEl = m.target.querySelector('article header')!;
    const header = headerEl.textContent ?? '';
    expect(header.trim().startsWith('Dara')).toBe(true);
    // The compact URN chip carries the full URN to copy.
    expect(headerEl.querySelector('[title="hrn:worker:acme.com:team:dara"]')).not.toBeNull();
    expect(header).toContain('(session bound by @binder)');
    m.unmount();
  });

  it('a resolved thread still offers Reply (DAB), beside Reopen', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1', { state: 'RESOLVED' }))]),
    });
    expect(buttons(m.target)).toEqual(expect.arrayContaining(['Reply', 'Reopen']));
    expect(buttons(m.target)).not.toContain('Resolve');
    m.unmount();
  });

  it("opening with the reader's own thread open notes it and scrolls to it (Uma, #6998)", () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-thread-id') ?? '');
    };
    try {
      const m = mountComponent(NodeDiscussion, {
        endpoint: ENDPOINT,
        shownRevision: 3,
        initial: discussion([thread(comment('c1'), false), thread(comment('c2'), true)]),
      });
      expect(m.target.querySelector('[data-testid="own-open-thread"]')).not.toBeNull();
      expect(scrolled).toEqual(['c2']);
      m.unmount();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('no own open thread: no note and no scroll', () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const m = mountComponent(NodeDiscussion, {
        endpoint: ENDPOINT,
        shownRevision: 3,
        initial: discussion([thread(comment('c1', { state: 'RESOLVED' }), true)]),
      });
      expect(m.target.querySelector('[data-testid="own-open-thread"]')).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      m.unmount();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("Gene on #1024: a confirmed write is reported up, so a remount from the page's copy still shows it", async () => {
    const posted = thread(comment('c9', { body: 'Kept across tabs' }), true);
    stubFetch({ ok: true, body: { ok: true, discussion: discussion([posted]) } });
    const reported: Discussion[] = [];
    const first = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([]),
      ondiscussion: (d: Discussion) => reported.push(d),
    });
    typeInto(first.target.querySelector<HTMLTextAreaElement>('#new-comment')!, 'Kept across tabs');
    first.target.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick(10);
    expect(reported).toHaveLength(1);
    first.unmount();
    // The page remounts the tab from what it was told, not from the loader's empty read.
    const second = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: reported[0] });
    expect(second.target.textContent).toContain('Kept across tabs');
    expect(second.target.textContent).not.toContain('No discussion yet');
    second.unmount();
  });

  it('Gene on #1024: Show more appends the next page from where the list ends, and reports it', async () => {
    const fetchMock = stubFetch({ ok: true, body: { discussion: { ...discussion([thread(comment('c2', { body: 'Second page' }))]), total: 2 } } });
    const reported: Discussion[] = [];
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: { ...discussion([thread(comment('c1'))]), total: 2 },
      ondiscussion: (d: Discussion) => reported.push(d),
    });
    (m.target.querySelector('[data-testid="more-threads"]') as HTMLButtonElement).click();
    await tick(10);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${ENDPOINT}?offset=1`);
    expect(m.target.textContent).toContain('Second page');
    expect(m.target.querySelector('[data-testid="more-threads"]')).toBeNull();
    const last = reported.at(-1);
    expect(last && last.ok ? last.threads.length : 0).toBe(2);
    m.unmount();
  });

  it("Gene on #1024: the reader's open thread off the first page can be found, then scrolled to", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-thread-id') ?? '');
    };
    try {
      stubFetch({ ok: true, body: { discussion: { ...discussion([thread(comment('mine', { body: 'My old thread' }), true)]), total: 2 } } });
      const m = mountComponent(NodeDiscussion, {
        endpoint: ENDPOINT,
        shownRevision: 3,
        initial: { ...discussion([thread(comment('other'))]), total: 2 },
        summary: { openThreads: 2, resolvedThreads: 0, comments: 2, viewerOpenThreadId: 'mine' },
      });
      expect(m.target.querySelector('[data-testid="own-open-thread"]')!.textContent).toContain('further down the list');
      // Nothing to scroll to yet: the thread isn't loaded.
      expect(scrolled).toEqual([]);
      (m.target.querySelector('[data-testid="find-own-thread"]') as HTMLButtonElement).click();
      await tick(12);
      expect(m.target.textContent).toContain('My old thread');
      expect(scrolled).toEqual(['mine']);
      m.unmount();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('a retracted comment renders as a stub, not its text', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1', { retracted: true, body: null }))]),
    });
    expect(m.target.textContent).toContain('Retracted by its author.');
    m.unmount();
  });

  it('with no known revision, offers no new thread, and tells a writer why', () => {
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: null, initial: discussion([]) });
    expect(m.target.querySelector('#new-comment')).toBeNull();
    expect(m.target.textContent).toContain('could not tell which one that is');
    m.unmount();
  });

  it('local review on #1024, P2-1: a fresh read is adopted in place, keeping the draft being written', () => {
    const props = reactiveProps<Record<string, unknown>>({ endpoint: ENDPOINT, shownRevision: 3, initial: discussion([]) });
    const m = mountComponent(NodeDiscussion as never, props as never) as ReturnType<typeof mountComponent>;
    typeInto(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!, 'Half-written thought');
    props.initial = discussion([thread(comment('c7', { body: 'Arrived meanwhile' }))]);
    flushSync();
    expect(m.target.textContent).toContain('Arrived meanwhile');
    expect(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!.value).toBe('Half-written thought');
    m.unmount();
  });

  it('Diego on #1024: an open editor saves against the revision it opened on, not a fresher one', async () => {
    const fetchMock = stubFetch({ ok: false, status: 409, body: { error: 'Someone changed this comment while you were reading it.' } });
    const props = reactiveProps<Record<string, unknown>>({
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1', { body: 'First wording', revSeq: 1 }), true)]),
    });
    const m = mountComponent(NodeDiscussion as never, props as never) as ReturnType<typeof mountComponent>;
    [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit')!.click();
    flushSync();
    typeInto(m.target.querySelector<HTMLTextAreaElement>('#edit-c1')!, 'My edit');
    expect(m.target.querySelector('[data-testid="edit-stale"]')).toBeNull();
    // The same author edits in another tab; this page's fresh read lands while the editor stays open.
    props.initial = discussion([thread(comment('c1', { body: 'Edited elsewhere', revSeq: 2 }), true)]);
    flushSync();
    expect(m.target.querySelector<HTMLTextAreaElement>('#edit-c1')!.value).toBe('My edit');
    expect(m.target.querySelector('[data-testid="edit-stale"]')).not.toBeNull();
    m.target.querySelector<HTMLTextAreaElement>('#edit-c1')!.form!.requestSubmit();
    await tick(10);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toMatchObject({ op: 'edit', commentId: 'c1', body: 'My edit', expectedRevision: 1 });
    m.unmount();
  });

  it('Gemma on #1024: a write on a thread past the first page keeps it, read back fresh', async () => {
    const reply = comment('r1', { body: 'Reply on page two', threadRootId: 'c2', isTopLevel: false });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body =
        init?.method === 'POST'
          ? // The write's read-back: page 1 only.
            { ok: true, discussion: { ...discussion([thread(comment('c1'))]), total: 2 } }
          : url.endsWith('?offset=1') && fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')
            ? { discussion: { ...discussion([{ ...thread(comment('c2', { body: 'Page two' })), replies: [reply], replyCount: 1 }]), total: 2 } }
            : { discussion: { ...discussion([thread(comment('c2', { body: 'Page two' }))]), total: 2 } };
      return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal('fetch', fetchMock);
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: { ...discussion([thread(comment('c1'))]), total: 2 },
    });
    (m.target.querySelector('[data-testid="more-threads"]') as HTMLButtonElement).click();
    await tick(10);
    expect(m.target.textContent).toContain('Page two');

    const page2 = m.target.querySelector<HTMLElement>('[data-thread-id="c2"]')!;
    [...page2.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reply')!.click();
    flushSync();
    typeInto(m.target.querySelector<HTMLTextAreaElement>('#reply-c2')!, 'Reply on page two');
    m.target.querySelector<HTMLTextAreaElement>('#reply-c2')!.form!.requestSubmit();
    await tick(15);
    expect(m.target.querySelector('[data-thread-id="c2"]')).not.toBeNull();
    expect(m.target.textContent).toContain('Reply on page two');
    expect(m.target.querySelector('[data-testid="more-threads"]')).toBeNull();
    m.unmount();
  });

  it('a failed read says so instead of showing an empty discussion', () => {
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: { ok: false } });
    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load the discussion");
    expect(m.target.textContent).not.toContain('No discussion yet');
    m.unmount();
  });
});
