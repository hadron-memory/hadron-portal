import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const dev = process.env.NODE_ENV !== 'production';
// The browser makes one cross-origin call — signin/signup POST to
// `${PUBLIC_SERVER_URL}/auth/email` — so connect-src must allow the auth
// server origin. Everything else is same-origin (/api/**, form actions).
// Normalize to the bare origin: a CSP host-source with a trailing slash or
// path would be an invalid/mismatching source.
const serverOrigin = new URL(process.env.PUBLIC_SERVER_URL ?? 'http://localhost:4000').origin;

// Asset uploads PUT the file bytes from the BROWSER straight to a presigned
// object-store URL, so the store's origin must also be in connect-src — but
// that origin is RUNTIME config (#700): it is appended to this header by the
// cspAssetStorage handle in src/hooks.server.ts, reading
// PUBLIC_ASSET_STORAGE_ORIGIN from $env/dynamic/public. Baking it here at
// build time made a Doppler-only change invisible to Docker's cached build
// and an unset value a silently narrower CSP.

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // #442: defense-in-depth CSP behind the app's {@html} sinks (all already
    // DOMPurify-sanitized). mode:'auto' nonces SvelteKit's own inline scripts,
    // so script-src can stay 'self' with no 'unsafe-inline' escape hatch — a
    // single sanitizer bypass then still can't execute injected script.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', 'https://challenges.cloudflare.com'],
        'frame-src': ['self', 'https://challenges.cloudflare.com'],
        // Many components emit inline style="" attributes; nonces don't cover
        // style attributes, so allow inline styles (low XSS risk).
        'style-src': ['self', 'unsafe-inline'],
        // GitHub avatars + user-supplied memory icon/hero URLs are arbitrary https.
        'img-src': ['self', 'data:', 'https:'],
        'font-src': ['self', 'data:'],
        // Same-origin API + the auth server; ws(s) for the Vite HMR client in
        // dev. The object-store origin is appended at runtime — see above.
        'connect-src': ['self', serverOrigin, ...(dev ? ['ws:', 'wss:'] : [])],
        'object-src': ['none'],
        'base-uri': ['self'],
        'frame-ancestors': ['none'],
        'form-action': ['self'],
      },
    },
  },
};

export default config;
