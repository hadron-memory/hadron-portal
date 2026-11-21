/**
 * #700: runtime CSP augmentation for the object-store origin.
 *
 * The origin used to be baked into the CSP at BUILD time (svelte.config.js),
 * which had two failure modes that compounded into a very expensive one:
 * an unset variable produced a valid CSP that merely lacked one source (no
 * error at build, boot, or request time — just a blocked upload in the
 * browser), and a Doppler-only change could never be picked up by a plain
 * rebuild because Docker's cache keys the build layer on context + command,
 * not on remotely-fetched values (`hrn:node:hadronmemory.com:dev:findings:doppler-change-needs-no-cache-rebuild`).
 *
 * So the origin is now read at runtime (hooks.server.ts) and appended to the
 * connect-src directive SvelteKit already emitted — changing it is a restart,
 * and an unset value logs loudly at boot instead of degrading silently.
 */

/** Normalize the configured object-store URL to a bare origin (a CSP
 *  host-source with a path or trailing slash would be invalid/mismatching).
 *  Logs loudly on unset/invalid — the silent-omission mode is exactly what
 *  made #700 expensive — and returns null so the CSP is left untouched. */
export function resolveAssetStorageOrigin(raw: string | undefined): string | null {
  if (!raw) {
    console.error(
      '[csp] PUBLIC_ASSET_STORAGE_ORIGIN is not set — the object-store origin will be ' +
        'missing from connect-src and browser asset uploads WILL fail with a CSP violation.'
    );
    return null;
  }
  try {
    return new URL(raw).origin;
  } catch {
    console.error(
      `[csp] PUBLIC_ASSET_STORAGE_ORIGIN is not a valid URL (${JSON.stringify(raw)}) — ` +
        'the object-store origin will be missing from connect-src and browser asset ' +
        'uploads WILL fail with a CSP violation.'
    );
    return null;
  }
}

/** Append `origin` to the connect-src directive of a serialized CSP header,
 *  leaving every other directive (including SvelteKit's script-src nonces)
 *  untouched. A header without a connect-src directive is returned unchanged
 *  (svelte.config.js always emits one); so is one that already lists the
 *  origin, keeping the append idempotent. */
export function appendConnectSrc(header: string, origin: string): string {
  return header
    .split(';')
    .map((part) => {
      const directive = part.trim();
      return directive.startsWith('connect-src') && !directive.split(/\s+/).includes(origin)
        ? `${directive} ${origin}`
        : directive;
    })
    .join('; ');
}

/** portal#2084 §10 F2: the hosts a form-action source may name. URL parsing (WHATWG) keeps `;`, `,`, `'`
 *  and the percent-encoded forms of them in a special-scheme host, and the serialized origin is spliced
 *  into a header that is split on `;` and read as space-separated sources, so any such character would
 *  end the directive or add a source. The parser has already lowercased the host and punycoded an IDN,
 *  so an allowlist is short: DNS labels (letters, digits, `-`, `_`) joined by dots, or a bracketed IPv6
 *  literal. `*` is refused by the same rule. */
const PUBLIC_HOST = /^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?|\[[0-9a-f:.]+\])$/;

/** #1716: Chrome applies form-action to a native POST's ceremony redirect.
 * The API origin is runtime PUBLIC configuration, never LOCAL_SERVER_URL or
 * a URL supplied by a form. Keep an explicit restrictive policy otherwise.
 */
export function appendPublicServerFormAction(
  header: string,
  raw: string | undefined,
): string {
  if (!raw) return header;
  let origin: string;
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !PUBLIC_HOST.test(url.hostname)
    )
      return header;
    origin = url.origin;
  } catch {
    return header;
  }
  return header
    .split(";")
    .map((part) => {
      const tokens = part.trim().split(/\s+/);
      if (
        tokens[0] !== "form-action" ||
        !tokens.includes("'self'") ||
        tokens.includes(origin)
      )
        return part.trim();
      return part.trim() + " " + origin;
    })
    .join("; ");
}
