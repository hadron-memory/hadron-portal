/**
 * #707 — what each malware-scan state is allowed to say to a user.
 *
 * The states come from `hrn:node:hadronmemory.com:specs:cor:dmo:060:12`, and the distinction that matters here
 * is that **PENDING and BLOCKED are not the same kind of "no"**:
 *
 * - `PENDING` — *downloadable later*, explicitly not an error. The row is
 *   retried indefinitely on backoff, so "wait" is true advice.
 * - `BLOCKED` — **terminal**. The spec is explicit that no later verdict may
 *   overwrite it, and the bytes are already deleted. Waiting will never help.
 *
 * Both surfaces that gate a download had a single message for the pair —
 * *"Available once the malware scan passes"* — which is correct for PENDING and
 * **false** for BLOCKED, where it invites the user to wait for something that
 * cannot happen. One sentence covering two states has to be true of both
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for`),
 * and this one was not.
 *
 * Keyed as a `Record` over the union rather than an if/else, so a fourth scan
 * state cannot quietly inherit another state's sentence
 * (`hrn:node:hadronmemory.com:hadron-portal:review:widening-a-union-recruits-every-fallback`).
 */
import { t } from '$lib/i18n/t';

export type ScanStatus = 'PENDING' | 'CLEAN' | 'BLOCKED';

/** Tooltip for a download control, per scan state. */
export function downloadTitle(status: ScanStatus): string {
  const titles: Record<ScanStatus, string> = {
    CLEAN: t('assets.download', 'Download'),
    // Conditional on the VERDICT, not on the scan completing (@codex, P2).
    // A pending scan can finish BLOCKED, so "once the scan finishes" promises
    // availability on an event that may deliver the opposite — the same
    // over-promise as the "once the scan passes" wording it replaced, one step
    // further out. Third wording in this spot, and the first that a blocked
    // outcome cannot falsify: it describes what is known (the scan is not
    // settled) and makes availability conditional
    // (`hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`).
    PENDING: t(
      'assets.download.pending',
      'The malware scan has not finished. This file is downloadable only if it passes.',
    ),
    BLOCKED: t(
      'assets.download.blocked',
      'Blocked by the malware scan. This is final — the file was deleted and cannot be downloaded.',
    ),
  };
  return titles[status];
}

/** Short state word for a chip or inline label. */
export function scanLabel(status: ScanStatus): string {
  const labels: Record<ScanStatus, string> = {
    CLEAN: t('assets.scan.clean', 'Clean'),
    PENDING: t('assets.scan.pending', 'Scanning'),
    BLOCKED: t('assets.scan.blocked', 'Blocked'),
  };
  return labels[status];
}

/**
 * Accessible name for a download control.
 *
 * A disabled download button announced "Download notes.md" while its reason for
 * being disabled lived only in `title` — so the fix for pointer users left
 * keyboard and screen-reader users with the same misleading affordance the
 * change set out to remove (@codex on #814). The reason belongs in the
 * accessible name, which is the only channel guaranteed to reach them.
 */
export function downloadAriaLabel(
  status: ScanStatus,
  filename: string,
  signature: string | null = null,
): string {
  const base = t('assets.download.aria', 'Download {file}').replace('{file}', filename);
  if (status === 'CLEAN') return base;
  // Sentence-join, not `join('. ')`. Some pieces already end in a period and
  // some do not, so a fixed separator produced "…cannot be downloaded.. Signature:"
  // — which a screen reader reads as a stutter. Found by reading the rendered
  // aria-label in the running app; the unit test that checks for `. .` was only
  // exercising the branch with no signature, where the join never happens.
  return [base, downloadTitle(status), scanSignatureText(status, signature)]
    .filter((part): part is string => Boolean(part))
    .map((part) => (part.trimEnd().endsWith('.') ? part.trimEnd() : `${part.trimEnd()}.`))
    .join(' ');
}

/**
 * The signature line for a BLOCKED asset, or null when there is nothing to say.
 *
 * Deliberately returns null rather than a placeholder for a blocked row the
 * scanner named nothing for. "Signature: unknown" reads as a failed lookup; the
 * honest rendering of "no signature was recorded" is to show no signature line.
 */
export function scanSignatureText(
  status: ScanStatus,
  signature: string | null,
): string | null {
  if (status !== 'BLOCKED' || !signature) return null;
  return t('assets.scan.signature', 'Signature: {sig}').replace('{sig}', signature);
}
