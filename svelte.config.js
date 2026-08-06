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
// object-store URL (that is the point of presigning — the bytes never
// transit hadron-server), so the store's origin has to be in connect-src or
// the upload dies at the final step with a CSP violation and no server-side
// trace. Env-driven rather than hardcoded because the store is configurable
// (`ASSET_STORAGE_ENDPOINT` server-side); currently Hetzner, e.g.
// https://nbg1.your-objectstorage.com. MinIO in local dev.
//
// NOTE this is baked in at BUILD time, like PUBLIC_SERVER_URL above — the
// variable must be present when the portal image is built, not merely at
// runtime, and changing it needs a rebuild.
const assetStorageOrigin = process.env.PUBLIC_ASSET_STORAGE_ORIGIN
  ? new URL(process.env.PUBLIC_ASSET_STORAGE_ORIGIN).origin
  : null;

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
        // Same-origin API + the auth server + the object store the browser
        // PUTs asset bytes to; ws(s) for the Vite HMR client in dev.
        'connect-src': [
          'self',
          serverOrigin,
          ...(assetStorageOrigin ? [assetStorageOrigin] : []),
          ...(dev ? ['ws:', 'wss:'] : []),
        ],
        'object-src': ['none'],
        'base-uri': ['self'],
        'frame-ancestors': ['none'],
        'form-action': ['self'],
      },
    },
  },
};

export default config;
