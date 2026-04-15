import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Standalone vitest config — we deliberately skip the SvelteKit plugin here
// because the endpoint tests only exercise POJO handlers and mock every
// `$lib/*` import. Pulling in `sveltekit()` would require a full .svelte-kit
// sync on every test run for no benefit.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
  },
});
