import { browser } from '$app/environment';

/**
 * portal#1448, and George's LOCAL P2 on #1450 — the id a MOUNTED editor
 * answers to is per MOUNT, not per worker.
 *
 * Superforms applies an arriving action reply (applyAction setting page.form)
 * to any mounted form whose id matches the reply's. A per-WORKER id (the
 * loader's stamp) already stopped worker A's reply landing in worker B's
 * editor, but both mounts of ONE worker shared it: return to A after a
 * A→B→A move and a reply from the earlier A mount — a save still in flight
 * across the move — matched the new editor and replaced a fresher draft with
 * the old one, resurrecting the old base with it.
 *
 * So a mounted browser instance mints a fresh id on top of the loader stamp
 * (`<stamp>#<uuid>`). The enhanced submit posts it as `__superform_id`, the
 * action's superValidate echoes it back (a posted id wins over the options
 * id), and the reply then matches only the mount that submitted — every
 * remount, even of the same worker, is a new epoch a stale reply cannot
 * enter. This is also why the stamp stays deterministic: a no-JS POST posts
 * no id, the action falls back to stamping the reply with it, and the server
 * render superForm matches page.form against the very same stamp — while a
 * mounted instance, whose id always carries the uuid suffix, can never match
 * a stamped reply again.
 *
 * The uuid never reaches the DOM (superforms adds `__superform_id` to the
 * submitted FormData in code, it renders no hidden input), so minting it on
 * the client only — the server render keeps the bare stamp — cannot desync
 * hydration.
 */
export function signatureInstanceId(loaderStamp: string): string {
  return browser ? `${loaderStamp}#${crypto.randomUUID()}` : loaderStamp;
}
