/**
 * #707 — copy for the asset surface's typed refusals.
 *
 * The defect these replace is not a missing sentence: it is that
 * `MALWARE_BLOCKED` was unmapped, so a verdict about the user's FILE arrived as
 * "the server had a problem". So the assertions that matter are about what each
 * message claims, not about its wording.
 */
import { describe, expect, it } from 'vitest';
import { assetErrorMessage } from './error-messages';

const SERVER_MESSAGE = 'upload rejected: file failed the malware scan';

describe('assetErrorMessage', () => {
  it('replaces the server prose for a known code', () => {
    const text = assetErrorMessage('MALWARE_BLOCKED', SERVER_MESSAGE);
    expect(text).not.toBe(SERVER_MESSAGE);
    expect(text).toContain('malware scan');
  });

  // The whole point of #707's first part: the reader must be able to tell a
  // verdict about their file from a fault on our side.
  it('says a blocked upload is a verdict on the file, not a fault on our side', () => {
    const text = assetErrorMessage('MALWARE_BLOCKED', SERVER_MESSAGE);
    expect(text).toMatch(/verdict on the file/i);
    expect(text).toMatch(/not (a problem with your request|.*fault)/i);
  });

  // `hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`
  // — "retrying will fail" is a prediction about a FUTURE scan, and a scanner
  // whose signatures were corrected since would falsify it. The mechanism
  // carries the same advice without the promise.
  it('does not promise that a retry will fail', () => {
    const text = assetErrorMessage('MALWARE_BLOCKED', SERVER_MESSAGE);
    expect(text).not.toMatch(/will fail|always fail|cannot be uploaded again/i);
    expect(text).toMatch(/same file goes to the same scan/i);
  });

  // PENDING is explicitly "downloadable later" in the spec, so the copy must
  // not read as breakage — and must not tell the reader to re-upload.
  it('treats a pending scan as not-yet rather than broken', () => {
    const text = assetErrorMessage('SCAN_PENDING', 'scan pending');
    expect(text).toMatch(/still being scanned/i);
    expect(text).toMatch(/nothing here needs re-uploading/i);
  });

  // BLOCKED is terminal by contract and the bytes are already deleted, so
  // "try again later" would be false.
  it('does not offer a later retry for a terminal block', () => {
    const text = assetErrorMessage('SCAN_BLOCKED', 'asset blocked by scan');
    expect(text).not.toMatch(/try again|later|minutes/i);
    expect(text).toMatch(/nothing left to download/i);
  });

  it.each([
    ['MEMORY_ENCRYPTED_NO_KEY', /unlock the memory/i],
    ['TOOL_NOT_ENABLED', /agent tools/i],
  ])('points %s at the action that clears it', (code, expected) => {
    expect(assetErrorMessage(code, 'raw')).toMatch(expected);
  });

  // The fallback is the design. An unknown code is one this build has not been
  // taught, and inventing a diagnosis for it is what
  // `hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`
  // forbids — the server's prose is worse copy and a true statement.
  it.each([
    ['an unknown code', 'SOME_FUTURE_REFUSAL'],
    ['no code at all', undefined],
    ['a code the portal deliberately does not map', 'ASSET_BYTES_GONE'],
  ])('falls back to the server message for %s', (_what, code) => {
    expect(assetErrorMessage(code, SERVER_MESSAGE)).toBe(SERVER_MESSAGE);
  });

  // @copilot on #833: a plain object literal inherits from Object.prototype,
  // so these resolve to something truthy and the fallback never runs. Two of
  // them do not even throw — `constructor` returns an OBJECT and `toString`
  // returns "[object Undefined]" — which renders garbage into an error slot
  // with nothing reporting a fault.
  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'falls back for the inherited key %s rather than resolving it',
    (code) => {
      expect(assetErrorMessage(code, SERVER_MESSAGE)).toBe(SERVER_MESSAGE);
    },
  );

  // Every mapped message must be a real sentence rather than an empty string —
  // a lookup that returns '' renders as a silent failure, which is the one
  // outcome worse than the raw prose.
  it.each(['MALWARE_BLOCKED', 'SCAN_PENDING', 'SCAN_BLOCKED', 'MEMORY_ENCRYPTED_NO_KEY', 'TOOL_NOT_ENABLED'])(
    '%s has non-empty copy',
    (code) => {
      const text = assetErrorMessage(code, SERVER_MESSAGE);
      expect(text.length).toBeGreaterThan(40);
      expect(text).not.toBe(SERVER_MESSAGE);
    },
  );
});
