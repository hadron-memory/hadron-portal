import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const dev = process.env.NODE_ENV !== 'production';
// The browser makes one cross-origin call — signin/signup POST to
// `${PUBLIC_SERVER_URL}/auth/email` — so connect-src must allow the auth
// server origin. Everything else is same-origin (/api/**, form actions).
// Normalize to the bare origin: a CSP host-source with a trailing slash or
// path would be an invalid/mismatching source.
const serverOrigin = new URL(process.env.PUBLIC_SERVER_URL ?? 'http://localhost:4000').origin;

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
        'script-src': ['self'],
        // Many components emit inline style="" attributes; nonces don't cover
        // style attributes, so allow inline styles (low XSS risk).
        'style-src': ['self', 'unsafe-inline'],
        // GitHub avatars + user-supplied memory icon/hero URLs are arbitrary https.
        'img-src': ['self', 'data:', 'https:'],
        'font-src': ['self', 'data:'],
        // Same-origin API + the auth server; ws(s) for the Vite HMR client in dev.
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
