/**
 * User-facing copy for the asset surface's typed refusals (#707).
 *
 * hadron-server#924 made `AssetUploadError.code` reach the wire as
 * `extensions.code`, which is what makes this possible at all: before it, every
 * asset refusal arrived as `INTERNAL_SERVER_ERROR` and a client could only echo
 * English prose. #707's first part waited on that for a month.
 *
 * Two jobs, and the second is the one that keeps this honest:
 *
 *  1. Turn a KNOWN code into a sentence that says what the server decided and
 *     what the reader can do about it — through `t()`, like every other
 *     user-visible string in this repo.
 *  2. Fall back to the server's own message for anything else. An unknown code
 *     is a code this build has not been taught, and inventing a diagnosis for
 *     it is exactly what
 *     `hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`
 *     forbids. The server's prose is worse copy and a true statement; a guess is
 *     better copy and possibly false.
 *
 * Deliberately NOT exhaustive over a union. `AssetUploadError.code` is a plain
 * string on the server, not a closed type, so there is no union to be exhaustive
 * over and a `Record<Code, …>` here would be a promise this module cannot keep.
 * The fallback is the design, not a gap in it.
 */
import { t } from '$lib/i18n/t';
import { lookupOwn } from '$lib/lookup';

/**
 * The scan verdicts (`hrn:node:hadronmemory.com:specs:cor:dmo:060:12`) and the
 * refusals that reach the portal's own `/api/assets/*` endpoints.
 *
 * Measured against hadron-server rather than copied from the issue: every entry
 * is thrown by an operation one of those endpoints calls. `ASSET_BYTES_GONE`
 * and `ASSET_NOT_DELETED` are deliberately absent — both come only from
 * `restoreAsset`, which the portal never calls, and copy for a refusal a reader
 * cannot reach is copy nobody will ever check.
 */
const MESSAGES: Record<string, () => string> = {
  // #707's headline. The server's own message — "upload rejected: file failed
  // the malware scan" — is accurate but reads like a transient fault, and the
  // issue asks for the one thing it does not say: this is a verdict, not a
  // hiccup.
  //
  // What it must NOT say is that a retry will fail. That is a prediction about
  // a future scan, and a scanner whose signatures have been corrected since
  // would falsify it. The mechanism is stated instead — the same file meets the
  // same scan — which is true and carries the same advice.
  MALWARE_BLOCKED: () => t(
    'assets.error.malware-blocked',
    'The malware scan rejected this file, so it was not uploaded. That is a verdict on the file itself rather than a problem with your request or a fault on our side — the same file goes to the same scan.',
  ),

  // Not an error: bytes exist and the caller may have them, just not yet. The
  // scan settles most uploads inline, so this is the scanner-outage path.
  SCAN_PENDING: () => t(
    'assets.error.scan-pending',
    'This file is still being scanned for malware, so it cannot be downloaded yet. The scan usually settles within minutes and the download unlocks itself — nothing here needs re-uploading.',
  ),

  // Terminal by contract: no later verdict overwrites BLOCKED, and the bytes
  // are already deleted. So the row a reader is looking at is the audit record,
  // and saying "try later" would be false.
  SCAN_BLOCKED: () => t(
    'assets.error.scan-blocked',
    'This file was blocked by the malware scan and its contents were deleted. The entry is kept as the record of what was blocked; there is nothing left to download.',
  ),

  // The memory is encrypted and this session holds no key for it. Actionable,
  // and the action is elsewhere — so it names where rather than implying the
  // reader should retry the same thing.
  MEMORY_ENCRYPTED_NO_KEY: () => t(
    'assets.error.memory-locked',
    'This memory is encrypted and has no active session key, so its files cannot be read or written. Unlock the memory, then try again.',
  ),

  // The agent may not use the asset tool in this App. A permission-shaped
  // refusal whose remedy is a specific screen this portal has.
  TOOL_NOT_ENABLED: () => t(
    'assets.error.tool-not-enabled',
    'The asset tool is not enabled for this agent, so it cannot upload or list files. An App admin can enable it in the App’s agent tools.',
  ),
};

/**
 * Copy for an asset failure: the mapped sentence, or the server's own message.
 *
 * `serverMessage` is required rather than optional so a caller cannot
 * accidentally drop the fallback and render an empty string for a code this
 * build does not know.
 */
export function assetErrorMessage(code: string | undefined, serverMessage: string): string {
  // `lookupOwn`, not a bare `MESSAGES[code]` (@copilot on #833). `code` arrives
  // from the wire, and a plain object literal inherits from Object.prototype —
  // so four of its keys break the fallback this module documents, two of them
  // WITHOUT throwing (`constructor` returns an object where the signature
  // promises a string; `toString` returns "[object Undefined]").
  //
  // This was #833's inline `Object.hasOwn`. #835 swept the rest — 19 lookups
  // across 12 files — and moved the guard behind one named helper, so the class
  // has a single implementation, a single test suite over the prototype keys,
  // and one thing for a reviewer to look for rather than a spelling to
  // re-derive per site.
  const mapped = lookupOwn(MESSAGES, code);
  return mapped ? mapped() : serverMessage;
}
