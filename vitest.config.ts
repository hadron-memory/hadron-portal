import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

// Standalone vitest config — we deliberately skip the SvelteKit plugin here
// because the endpoint tests only exercise POJO handlers and mock every
// `$lib/*` import. Pulling in `sveltekit()` would require a full .svelte-kit
// sync on every test run for no benefit.
//
// The base `svelte()` plugin (NOT `sveltekit()`) is included so the handful
// of component tests can `import` and server-side-render `.svelte` files via
// `svelte/server`. It only transforms `.svelte` imports, so the POJO handler
// tests above are unaffected and no DOM environment is needed.
export default defineConfig({
  plugins: [svelte()],
  test: {
    // `scripts/` is in scope for the GraphQL drift gate's own test (#681),
    // which proves the validator still fails on a drifted operation.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
  },
});
