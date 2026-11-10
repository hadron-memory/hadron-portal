import { t } from '$lib/i18n/t';
import { startByIso } from './start-by';
import { readReferences, referenceInput, sameReferences } from './references';

/**
 * portal#1357 — what the Edit details form sends (hadron-server#2645,
 * `updateAgentTask`, a strict patch: a named field replaces, an omitted one is
 * left alone, an empty optional one clears).
 *
 * The form posts each editable field beside its BASE, the value it showed
 * when it opened. A field goes into the patch only when its base was posted
 * AND the reader changed it, so merely opening and saving sends nothing, and a
 * crafted post that names no base cannot overwrite a field it never showed.
 * Source, owner, assignee, status, parent, priority and blockers are never
 * read here: they are not editable through this call.
 *
 * portal#1575 — references (hrn:node:hadronmemory.com:specs:cor:agt:050:09): a list REPLACES the whole list,
 * so after any change (an add, a remove, a reorder, a relabel) the whole
 * ordered list goes, `[]` when the last one was removed; untouched, the field
 * is left out. Like every other field, nothing goes without its posted base.
 */
export type TaskEditPatch =
  | { input: Record<string, unknown> }
  | { invalid: { field: string; message: string } };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const all = (fd: FormData, k: string) => [...new Set(fd.getAll(k).map((v) => String(v).trim()).filter(Boolean))];
const tagList = (text: string) => [...new Set(text.split(',').map((x) => x.trim()).filter(Boolean))];
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: string[], b: string[]) => sameList([...a].sort(), [...b].sort());
/** The control carries no seconds: two instants in the same minute are the same choice. */
const minute = (iso: string) => iso.slice(0, 16);

interface Requirements {
  role: string | null;
  familyIn: string[];
  familyNotIn: string[];
  excludeWorkers: string[];
  minTier: string | null;
}

function readBaseRequirements(raw: FormDataEntryValue | null): Requirements | null {
  if (typeof raw !== 'string') return null;
  try {
    const b = JSON.parse(raw) as Partial<Requirements> | null;
    if (!b || typeof b !== 'object') return null;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
    return { role: typeof b.role === 'string' && b.role.trim() ? b.role.trim() : null, familyIn: list(b.familyIn), familyNotIn: list(b.familyNotIn), excludeWorkers: list(b.excludeWorkers), minTier: typeof b.minTier === 'string' && b.minTier.trim() ? b.minTier.trim() : null };
  } catch {
    return null;
  }
}

export function taskEditPatch(fd: FormData): TaskEditPatch {
  const input: Record<string, unknown> = {};

  if (fd.has('titleBase')) {
    const title = str(fd, 'title');
    if (!title) {
      return { invalid: { field: 'title', message: t('app.tasks.write.title-required', 'Give the task a title.') } };
    }
    if (title !== str(fd, 'titleBase')) input.title = title;
  }

  if (fd.has('descriptionBase')) {
    const description = str(fd, 'description');
    if (description !== str(fd, 'descriptionBase')) input.description = description === '' ? null : description;
  }

  if (fd.has('tagsBase')) {
    const tags = tagList(String(fd.get('tags') ?? ''));
    if (!sameList(tags, tagList(String(fd.get('tagsBase') ?? '')))) input.tags = tags;
  }

  if (fd.has('startByBase')) {
    const local = str(fd, 'startBy');
    const iso = local || str(fd, 'startByUtc') ? startByIso(local, str(fd, 'startByUtc')) : '';
    if (iso === null) {
      return { invalid: { field: 'startBy', message: t('app.tasks.edit.start-by-invalid', 'Choose a valid start-by date and time, or clear it.') } };
    }
    const base = str(fd, 'startByBase');
    if (minute(iso) !== minute(base)) input.startBy = iso === '' ? null : iso;
  }

  if (fd.has('closeSessionWhenDoneBase')) {
    const was = fd.get('closeSessionWhenDoneBase');
    const now = fd.get('closeSessionWhenDone') === 'on';
    if ((was === 'true' || was === 'false') && now !== (was === 'true')) input.closeSessionWhenDone = now;
  }

  if (fd.has('referencesBase')) {
    const was = readReferences(fd.get('referencesBase'));
    const now = readReferences(fd.get('references'));
    if (!was || !now) {
      return { invalid: { field: 'references', message: t('app.tasks.edit.references-unreadable', 'The references couldn’t be read. Reload the page and try again.') } };
    }
    if (!sameReferences(now, was)) input.references = now.map(referenceInput);
  }

  const base = readBaseRequirements(fd.get('requirementsBase'));
  if (base) {
    const role = str(fd, 'role') || null;
    const familyIn = all(fd, 'familyIn');
    // The server takes one family list or the other; "run as" wins, as on the create form.
    const familyNotIn = familyIn.length ? [] : all(fd, 'familyNotIn');
    const excludeWorkers = all(fd, 'excludeWorkers');
    const minTier = str(fd, 'minTier') || null;
    const baseNotIn = base.familyIn.length ? [] : base.familyNotIn;
    if (role !== base.role || !sameSet(familyIn, base.familyIn) || !sameSet(familyNotIn, baseNotIn) || !sameSet(excludeWorkers, base.excludeWorkers) || minTier !== base.minTier) {
      const requirements: Record<string, unknown> = {};
      if (role) requirements.role = role;
      if (familyIn.length) requirements.familyIn = familyIn;
      else if (familyNotIn.length) requirements.familyNotIn = familyNotIn;
      if (excludeWorkers.length) requirements.excludeWorkers = excludeWorkers;
      if (minTier) requirements.minTier = minTier;
      input.requirements = Object.keys(requirements).length ? requirements : null;
    }
  }

  return { input };
}
