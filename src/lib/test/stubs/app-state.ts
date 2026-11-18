/**
 * Stand-in for `$app/state` in the client test lane (portal#1528).
 *
 * Aliased alongside the other `$app/*` stubs. Kit's `$app/state` exposes the
 * same page as `$app/stores`, but as a reactive object instead of a store, so
 * this reads through to the writable stub page in `app-stores.ts`: a test sets
 * the URL (or anything else) there once, and a component reading either module
 * sees it.
 *
 * NOT reactive (portal#1532 item 6): each getter is a `get(pageStore)` snapshot
 * taken when it is read, whereas kit's `page` is a rune-backed object. A
 * template or `$derived` reading it here re-reads only when something ELSE
 * re-runs it, so a test that changes the page after mount must not rely on
 * this stub alone to re-render; drive the change through the `form` prop
 * (see `mountPage` in `email-submit-failure.client.test.ts`) or remount.
 */
import { get } from 'svelte/store';
import { page as pageStore } from './app-stores';

export const page = {
  get url() {
    return get(pageStore).url;
  },
  get params() {
    return get(pageStore).params;
  },
  get route() {
    return get(pageStore).route;
  },
  get status() {
    return get(pageStore).status;
  },
  get error() {
    return get(pageStore).error;
  },
  get data() {
    return get(pageStore).data;
  },
  get form() {
    return get(pageStore).form;
  },
};
