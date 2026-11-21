<script lang="ts" generics="T">
  /**
   * portal#2261 — reads one deferred section of the task page when it is first SHOWN (scrolled into
   * view), once per visit, and hands the answer to `children`. The first load carries only the first
   * screen, so a page open never holds the reads of sections nobody looked at.
   *
   * The answer is a value: a failed read arrives as {kind:'failed'} and each section already renders
   * that as its own "couldn't load" state, never as an empty section (#1392/#1588). Children mount
   * AFTER the answer, so a section that takes its first page as `initial` reads it once.
   * Where IntersectionObserver is missing the section reads at once.
   */
  import { onMount, untrack, type Snippet } from 'svelte';
  import { t } from '$lib/i18n/t';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { readSection, type TaskSection } from '$lib/agent-tasks/sections';

  let { appId, taskId, section, version, children, placeholder, onread, label = t('app.tasks.section.loading', 'Loading…') }: {
    appId: string;
    taskId: string;
    section: TaskSection;
    /** Changes whenever the page's data is refreshed (a write on the same task): a section already shown re-reads. */
    version?: unknown;
    /** Shown instead of the plain label until the answer lands, and kept for a reader without JS (portal#2263 P2#4). */
    placeholder?: Snippet;
    children: Snippet<[T]>;
    /** Told each answer as it lands, and `null` when the section starts over, so a caller can keep a live region of its own OUTSIDE `children` (which mount only after the answer). */
    onread?: (answer: T | null) => void;
    label?: string;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  let read = $state.raw<T | null>(null);
  // The task this answer belongs to: the page reuses this component across tasks, so a new task starts over.
  let answeredFor = '';
  let ctl: AbortController | null = null;

  async function load() {
    const id = untrack(() => taskId);
    const app = untrack(() => appId);
    ctl?.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    const answer = await readSection<T>(app, id, untrack(() => section), signal);
    if (signal.aborted) return;
    answeredFor = id;
    read = answer as T;
    onread?.(answer as T);
  }

  let observer: IntersectionObserver | null = null;
  function watch() {
    observer?.disconnect();
    observer = null;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return;
    }
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer?.disconnect();
        observer = null;
        void load();
      }
    }, { rootMargin: '200px' });
    observer.observe(host);
  }

  onMount(() => {
    watch();
    return () => {
      observer?.disconnect();
      ctl?.abort();
    };
  });

  // Another task in the same component: abort a read still in flight, forget any answer, and wait to be
  // shown again. It acts whether or not an answer has landed: a read in flight for task A must never fill
  // task B's section (the page reuses this component across tasks). It runs before the DOM updates, so
  // `children` never renders task A's answer against task B's props.
  // The same task with fresh page data (an assign, an edit, a blocker, a priority change) re-reads a section
  // that was already shown, in place, so History and Review never keep the answer from before the write.
  let seen: string | null = null;
  let seenVersion: unknown = undefined;
  $effect.pre(() => {
    const id = taskId;
    const v = version;
    untrack(() => {
      if (seen !== null && id !== seen) {
        ctl?.abort();
        ctl = null;
        read = null;
        onread?.(null);
        answeredFor = '';
        watch();
      } else if (seen !== null && v !== seenVersion && read !== null) {
        void load();
      }
      seen = id;
      seenVersion = v;
    });
  });
</script>

<div bind:this={host}>
  <LiveRegion>{#if read === null && !placeholder}<p class="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>{/if}</LiveRegion>
  {#if read !== null}
    {@render children(read as T)}
  {:else if placeholder}
    {@render placeholder()}
  {/if}
</div>
