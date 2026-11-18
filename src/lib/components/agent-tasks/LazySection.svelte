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
  import { readSection, type TaskSection } from '$lib/agent-tasks/sections';

  let { appId, taskId, section, children, label = t('app.tasks.section.loading', 'Loading…') }: {
    appId: string;
    taskId: string;
    section: TaskSection;
    children: Snippet<[T]>;
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

  // Another task in the same component: forget the answer and wait to be shown again.
  $effect(() => {
    const id = taskId;
    untrack(() => {
      if (answeredFor && id !== answeredFor) {
        read = null;
        answeredFor = '';
        watch();
      }
    });
  });
</script>

<div bind:this={host}>
  {#if read !== null}
    {@render children(read as T)}
  {:else}
    <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
  {/if}
</div>
