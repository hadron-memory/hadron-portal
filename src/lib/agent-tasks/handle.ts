import { composeAgentTaskUrnV2, parseUrnV2 } from '$lib/urn/parse-urn';

/**
 * portal#1349 — an agent task's short handle (`AT3.405`), as the portal reads it.
 *
 * The server owns the handle law (hrn:node:hadronmemory.com:specs:cor:agt:050:01;
 * hadron-server `parseTaskHandle`) and resolves it for every call that takes a
 * task id. Nothing here resolves a handle: this file only (a) spots a string
 * that LOOKS like one so a search box knows when to ask the server, (b) builds
 * the link a task row points at, and (c) qualifies a route segment with the
 * route's own, already-authorized App before it is forwarded. The grammar below
 * mirrors the server's so a lookalike is never sent as a handle; the server
 * still decides what is one.
 */

/** hrn:node:hadronmemory.com:specs:cor:urn:010:01 — a handle is a URN leaf, at most 64 characters. */
export const MAX_HANDLE_LENGTH = 64;
export const MAX_HANDLE_DEPTH = 16;
const MAX_NUMBER = 9223372036854775807n;
const PATH = 'AT(?:0|[1-9][0-9]{0,18})(?:\\.[1-9][0-9]{0,18})*';
const BARE = new RegExp(`^(${PATH})$`, 'i');
// Two or more App parts, as the server takes them (it also normalizes an
// `hrn:app:<root>:<slug>` App part): anything but this App's exact
// `<root>:<slug>` is then refused by resolveSegment before a lookup (Riana §10 P3, portal#1375).
const QUALIFIED = new RegExp(`^hrn:agenttask:((?:[^\\s:/]+:)+[^\\s:/]+):(${PATH})$`, 'i');

export interface ParsedHandle {
  /** Canonical, upper case. */
  handle: string;
  /** The App part of a qualified spelling (`<root>:<app-slug>`, or longer), null for a bare one. */
  appUrn: string | null;
}

/** The handle a string spells, or null. No trimming: a trailing space is not a handle. */
export function parseHandle(ref: string): ParsedHandle | null {
  const bare = BARE.exec(ref);
  const m = bare ?? QUALIFIED.exec(ref);
  if (!m) return null;
  const path = (bare ? m[1]! : m[2]!).toUpperCase();
  if (path.length > MAX_HANDLE_LENGTH) return null;
  const segments = path.slice(2).split('.');
  if (segments.length > MAX_HANDLE_DEPTH) return null;
  if (segments.some((s) => BigInt(s) > MAX_NUMBER)) return null;
  return { handle: path, appUrn: bare ? null : m[1]! };
}

/** The project-zero ("No project") task: read-by-handle, backlog, never writable. */
export const PROJECT_ZERO_HANDLE = 'AT0';
export const isProjectZero = (handle: string | null | undefined): boolean => handle === PROJECT_ZERO_HANDLE;

/** `<root>:<app-slug>` of an App URN (`hrn:app:<root>:<slug>`), or null when it is not one. */
function appKey(appUrn: string): { root: string; slug: string } | null {
  try {
    const p = parseUrnV2(appUrn);
    if (p.type !== 'app' || p.segments.length !== 1) return null;
    return { root: p.root, slug: p.segments[0]! };
  } catch {
    return null;
  }
}

/**
 * What a route segment means inside the App the viewer was already authorized
 * for.
 *   - not a handle (a raw id, or anything else)  → forwarded unchanged
 *   - a bare handle                               → qualified with THIS App, so a person
 *                                                   in several Apps is never asked to
 *                                                   qualify it
 *   - a qualified handle of THIS App              → forwarded
 *   - a qualified handle of another App           → `unknown`, before any task read, with
 *                                                   no redirect and no existence signal
 * The ambient/active App is never consulted.
 */
export type SegmentRef = { kind: 'ref'; ref: string } | { kind: 'unknown' };

export function resolveSegment(segment: string, appUrn: string): SegmentRef {
  const parsed = parseHandle(segment);
  if (!parsed) return { kind: 'ref', ref: segment };
  const app = appKey(appUrn);
  if (!app) return { kind: 'unknown' };
  if (parsed.appUrn !== null && parsed.appUrn.toLowerCase() !== `${app.root}:${app.slug}`.toLowerCase()) {
    return { kind: 'unknown' };
  }
  return { kind: 'ref', ref: composeAgentTaskUrnV2(app.root, app.slug, parsed.handle) };
}

/**
 * Where a task row points: under its App (`basePath` is `/app/apps/<id>`), by its immutable handle when the
 * server gave one, else by id (an id link still resolves). Every dynamic
 * segment is encoded.
 */
export function taskHref(basePath: string, task: { id: string; handle?: string | null }): string {
  return `${basePath}/tasks/${encodeURIComponent(task.handle || task.id)}`;
}
