import { t } from '$lib/i18n/t';
import { startByIso } from './start-by';
import { readReferences, referenceInput, sameReferences } from './references';
import { readBaseRequirements, requirementsOverride, sameList, str, tagList } from './form-bases';

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
 *
 * The base-diff grammar is shared with clone.ts (portal#2161) through form-bases.ts.
 */
export type TaskEditPatch =
  | { input: Record<string, unknown> }
  | { invalid: { field: string; message: string } };

/** The control carries no seconds: two instants in the same minute are the same choice. */
const minute = (iso: string) => iso.slice(0, 16);

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

  // The requirements controls are always visible on the Edit panel, so an emptied set is real.
  const base = readBaseRequirements(fd.get('requirementsBase'));
  if (base) {
    const override = requirementsOverride(fd, base);
    if (override !== undefined) input.requirements = override;
  }

  return { input };
}
