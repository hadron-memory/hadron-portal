/**
 * Browser-proof harness for the tasks board (portal#2244).
 *
 * Mounts the real tasks `+page.svelte` (through `TaskBoardHarness`, the same
 * fixture the client-lane tests mount) on a bare document with loader data the
 * driver supplies — the way `app-page-roster-harness` mounts the App page for
 * the roster proofs: no SvelteKit request context, no backend, `$app/*`
 * rewritten to the test stubs by the driver's transform.
 *
 * `window.__mountBoard(initial)` returns an unmount handle; `initial` is the
 * `+page.server.ts` payload (board view), rows exactly as the server returns
 * them.
 */
import { mount, unmount } from 'svelte';
import Harness from './TaskBoardHarness.svelte';

declare global {
  interface Window {
    __mountBoard: (initial: unknown) => Promise<{ unmount: () => void }>;
  }
}

window.__mountBoard = async (initial: unknown) => {
  const target = document.createElement('div');
  target.className = 'p-4';
  document.body.appendChild(target);
  const app = mount(Harness as never, { target, props: { initial } as never });
  return {
    unmount: () => {
      void unmount(app);
      target.remove();
    },
  };
};

export {};
