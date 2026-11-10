import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { testMaxWorkers } from './scripts/test-max-workers.mjs';

const $lib = resolve(__dirname, 'src/lib');

// Standalone vitest config — we deliberately skip the SvelteKit plugin here
// because the endpoint tests only exercise POJO handlers and mock every
// `$lib/*` import. Pulling in `sveltekit()` would require a full .svelte-kit
// sync on every test run for no benefit.
//
// TWO PROJECTS, one `pnpm test` (#795).
//
// `node` is what this file has always been: POJO handlers and server-side
// `render` from `svelte/server`, in a node environment with no DOM. That
// choice was deliberate and stays the default — it is fast, and SSR
// correctness genuinely matters here.
//
// `client` is additive. It exists because a server render NEVER MOUNTS, so
// `onMount`, `onDestroy`, effects and every teardown path were unreachable
// from the suite — 15 tests using `svelte/server`, 0 able to reach a
// lifecycle. Two shipped defects went through that gap (#782/#788,
// #789/#794), both found by driving the app by hand because nothing else
// could see them.
//
// The lane is chosen by FILENAME (`*.client.test.ts`), not by directory, so a
// component's DOM test sits next to its SSR test. `node` excludes that suffix
// explicitly — without the exclude, every client test would also run under
// node and fail on `mount(...) is not available on the server`.
//
// `resolve.conditions: ['browser']` is the load-bearing line in the client
// project. Vitest transforms modules through its SSR pipeline, so without it
// the bare `svelte` import resolves to `index-server.js` and `mount()` throws
// `lifecycle_function_unavailable` — the failure that makes this look
// impossible rather than merely unconfigured.
export default defineConfig({
  test: {
    // Hugo's #28704: a host can cap the worker pool with HADRON_TEST_MAX_WORKERS
    // (a positive integer); unset, vitest's default is unchanged.
    maxWorkers: testMaxWorkers(process.env.HADRON_TEST_MAX_WORKERS),
    projects: [
      {
        plugins: [svelte()],
        test: {
          name: 'node',
          // `scripts/` is in scope for the GraphQL drift gate's own test
          // (#681), which proves the validator still fails on a drifted
          // operation.
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.client.test.ts'],
          environment: 'node',
        },
        resolve: { alias: {
          $lib,
          // SSR task-page rendering now includes the native reload URL. Share
          // the same page-store fixture as mounted tests, rather than per-test mocks.
          '$app/stores': resolve(__dirname, 'src/lib/test/stubs/app-stores.ts'),
          // portal#1649: server-rendered pages whose children navigate or read the URL.
          '$app/navigation': resolve(__dirname, 'src/lib/test/stubs/app-navigation.ts'),
          '$app/state': resolve(__dirname, 'src/lib/test/stubs/app-state.ts'),
          // portal#1022: the account loader (node lane, via page.server tests)
          // builds the passkey-registration link from the public server base.
          // Same stub the client lane resolves it to — a plain record tests
          // can set per case.
          '$env/dynamic/public': resolve(__dirname, 'src/lib/test/stubs/env-dynamic-public.ts'),
        } },
      },
      {
        plugins: [svelte()],
        test: {
          name: 'client',
          include: ['src/**/*.client.test.ts'],
          environment: 'jsdom',
        },
        resolve: {
          conditions: ['browser'],
          alias: {
            $lib,
            // `$app/*` has no implementation outside a running SvelteKit app.
            // Aliased to a recorder rather than mocked per-test, so every
            // component that navigates gets the same one.
            //
            // #668: aliases, NOT per-test `vi.mock`, is the only thing that
            // works for `environment` and `stores` — Vite resolves imports
            // while transforming `sveltekit-superforms` (SuperDebug pulls in
            // both), which happens BEFORE any mock is installed, so a mocked
            // test dies at import with a resolver error instead of running.
            '$app/navigation': resolve(__dirname, 'src/lib/test/stubs/app-navigation.ts'),
            '$app/environment': resolve(__dirname, 'src/lib/test/stubs/app-environment.ts'),
            '$app/stores': resolve(__dirname, 'src/lib/test/stubs/app-stores.ts'),
            '$app/state': resolve(__dirname, 'src/lib/test/stubs/app-state.ts'),
            '$app/forms': resolve(__dirname, 'src/lib/test/stubs/app-forms.ts'),
            '$env/dynamic/public': resolve(__dirname, 'src/lib/test/stubs/env-dynamic-public.ts'),
          },
        },
      },
    ],
  },
});
