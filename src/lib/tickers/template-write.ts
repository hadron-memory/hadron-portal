import { t } from '$lib/i18n/t';
import { WRITABLE_REASONS, type WritableReason } from '$lib/tickers/write';

/**
 * portal#1609 (Agent ticker templates, slice C of #1141) — what the template
 * forms send, parsed from the POST itself.
 *
 * - Create sends exactly name, cadence and an explicit non-empty reasons set.
 * - An edit sends only the fields the reader changed, always with the
 *   `expectedRevision` the page READ (a stale one is the server's refusal).
 *   Reasons are sent only when the form showed them (a template carrying a
 *   reason this build can't show keeps its set) and never as `[]`.
 * - Quiet hours are removed with `clearQuietHours: true`, never with null,
 *   and are never set here (the server's patch has no use for a client-built
 *   schedule in this slice).
 * - Nothing checks a cadence's range: a template has no App floor
 *   (hrn:node:hadronmemory.com:specs:cor:agt:080:33), and the server's
 *   refusal is the answer.
 */
export type TemplateInvalid = { invalid: { field: 'name' | 'cadenceSeconds' | 'reasons' | 'form'; message: string } };

const GRAPHQL_INT_MAX = 2_147_483_647;

const isWritable = (r: string): r is WritableReason => (WRITABLE_REASONS as readonly string[]).includes(r);

function chosenReasons(fd: FormData): WritableReason[] {
  const picked = new Set(fd.getAll('reasons').filter((v): v is string => typeof v === 'string'));
  return WRITABLE_REASONS.filter((r) => picked.has(r));
}

const nameMessage = () => t('agent.tickers.write.name-required', 'Enter a name.');
const cadenceMessage = () => t('agent.tickers.write.cadence-whole', 'Enter a whole number of seconds.');
const reasonsMessage = () => t('agent.tickers.write.reasons-required', 'Choose at least one reason. A ticker with none never fires.');
const unusableMessage = () => t('agent.tickers.write.unusable', 'This form can’t be sent. Reload the page and try again.');
const nothingChangedMessage = () => t('agent.tickers.write.nothing-changed', 'Change a value to save.');

function parseWhole(raw: string): number | null {
  return /^\d+$/.test(raw) && Number(raw) <= GRAPHQL_INT_MAX ? Number(raw) : null;
}

const formInvalid = (): TemplateInvalid => ({ invalid: { field: 'form', message: unusableMessage() } });

/** One non-empty id value, bounded and without markup characters. */
function parseId(fd: FormData): string | null {
  const all = fd.getAll('id');
  if (all.length !== 1 || typeof all[0] !== 'string') return null;
  return /^[A-Za-z0-9._:-]{1,512}$/.test(all[0]) ? all[0] : null;
}

function parseRevision(fd: FormData): number | null {
  const all = fd.getAll('expectedRevision');
  if (all.length !== 1 || typeof all[0] !== 'string') return null;
  return parseWhole(all[0].trim());
}

export function buildTemplateCreateInput(
  fd: FormData,
): { input: { name: string; cadenceSeconds: number; reasons: WritableReason[] } } | TemplateInvalid {
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { invalid: { field: 'name', message: nameMessage() } };
  const cadenceSeconds = parseWhole(String(fd.get('cadenceSeconds') ?? '').trim());
  if (cadenceSeconds === null) return { invalid: { field: 'cadenceSeconds', message: cadenceMessage() } };
  const reasons = chosenReasons(fd);
  if (reasons.length === 0) return { invalid: { field: 'reasons', message: reasonsMessage() } };
  return { input: { name, cadenceSeconds, reasons } };
}

export type TemplatePatch = { name?: string; cadenceSeconds?: number; reasons?: WritableReason[]; clearQuietHours?: true };

export function buildTemplateUpdate(
  fd: FormData,
): { id: string; expectedRevision: number; patch: TemplatePatch } | TemplateInvalid {
  const id = parseId(fd);
  const expectedRevision = parseRevision(fd);
  if (id === null || expectedRevision === null) return formInvalid();

  const patch: TemplatePatch = {};

  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { invalid: { field: 'name', message: nameMessage() } };
  if (name !== String(fd.get('nameWas') ?? '').trim()) patch.name = name;

  const rawCadence = String(fd.get('cadenceSeconds') ?? '').trim();
  const cadenceSeconds = parseWhole(rawCadence);
  if (cadenceSeconds === null) return { invalid: { field: 'cadenceSeconds', message: cadenceMessage() } };
  if (rawCadence !== String(fd.get('cadenceSecondsWas') ?? '').trim()) patch.cadenceSeconds = cadenceSeconds;

  if (fd.get('reasonsShown') === '1') {
    const reasons = chosenReasons(fd);
    const was = String(fd.get('reasonsWas') ?? '').split(',').filter(isWritable);
    const changed = reasons.length !== was.length || reasons.some((r) => !was.includes(r));
    if (changed) {
      if (reasons.length === 0) return { invalid: { field: 'reasons', message: reasonsMessage() } };
      patch.reasons = reasons;
    }
  }

  if (fd.get('clearQuietHours') === '1') patch.clearQuietHours = true;

  if (Object.keys(patch).length === 0) return { invalid: { field: 'form', message: nothingChangedMessage() } };
  return { id, expectedRevision, patch };
}

export function buildTemplateDelete(fd: FormData): { id: string; expectedRevision: number } | TemplateInvalid {
  const id = parseId(fd);
  const expectedRevision = parseRevision(fd);
  if (id === null || expectedRevision === null) return formInvalid();
  return { id, expectedRevision };
}
