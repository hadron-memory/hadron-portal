/**
 * Percent-encode the characters that would let a URN escape its single path
 * segment in an `/app/u/<urn>` href (#1512).
 *
 * A URN's grammar is colon-delimited atoms (`hrn:node:hadronmemory.com:specs:cor:urn:010:01`), so none of these
 * occur in a well-formed one and a normal URN comes out byte-identical. They do
 * occur in an AUTHORED target (`[[hrn:node:a:b:../../../settings/tokens|x]]`),
 * and unencoded the browser resolves that to `/app/settings/tokens`:
 *  - `/`  starts a new segment, so `..` walks out of `/app/u/`.
 *  - `\\`  is read as `/` by the URL parser for http(s) links.
 *  - `?` `#` end the path and let the target smuggle a query or fragment.
 *  - `%`  must be encoded too, or an authored `%2F` would decode to `/` on the
 *    far side and the encoding would not round-trip.
 *
 * `.` needs no encoding: with `/` and `\\` encoded a dot can only sit inside a
 * segment that begins `hrn:`/`urn:`, never be a `..` segment of its own.
 *
 * The `/app/u/[urn]` route receives the decoded value (SvelteKit decodes route
 * params), so the resolver still sees the original URN.
 */
export function encodeUrnPathSegment(urn: string): string {
  return urn.replace(/[/\\?#%]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}
