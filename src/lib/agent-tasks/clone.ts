import { t } from '$lib/i18n/t';
import { readTaskPriority } from './planning';
import { readReferences, referenceInput, sameReferences } from './references';

/**
 * portal#2161 (hadron-server#3244, hrn:node:hadronmemory.com:specs:cor:agt:050:02 "What a clone
 * does"): what the Clone form sends. `cloneAgentTask` copies the source's title, description,
 * source, tags, requirements, references, close-session-when-done, priority, properties and
 * parent — an omitted input field keeps the source's value, a NAMED one (empty included)
 * overrides it. So the form works exactly like the Edit details form (portal#1357): every copied
 * field posts beside its BASE, the value the form pre-filled, and goes into the input only when
 * its base was posted AND the reader changed it. Merely opening and saving sends `{}`, and a
 * field the person EMPTIES is sent empty (`""`, `[]`, `null`) — never dropped as "unchanged",
 * which would silently copy the source's value back.
 *
 * The parent posts one vocabulary, `cloneParent` beside `cloneParentBase`: `project` (a root
 * source; the server clones it as a project), `none` (a root under AT0 — also the truthful
 * pre-fill when the source's parent has ended or is AT0, since the server puts the clone under
 * AT0 then), or `parent:<id>`. Only a CHANGE names a parent: `parentTaskId: <id>` for a kept or
 * newly picked one, `parentTaskId: null` for "No project".
 *
 * Not read here — not copied and not base-diffed: owner, assignee, status, startBy (the action
 * adds them as on a plain create), blockers and handle (not in the clone input at all).
 */
export type TaskClonePatch =
  | { input: Record<string, unknown> }
  | { invalid: { field: string; message: string } };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const all = (fd: FormData, k: string) => [...new Set(fd.getAll(k).map((v) => String(v).trim()).filter(Boolean))];
const tagList = (text: string) => [...new Set(text.split(',').map((x) => x.trim()).filter(Boolean))];
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: string[], b: string[]) => sameList([...a].sort(), [...b].sort());

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

export function taskClonePatch(fd: FormData): TaskClonePatch {
  const input: Record<string, unknown> = {};

  if (fd.has('titleBase')) {
    const title = str(fd, 'title');
    if (!title) {
      return { invalid: { field: 'title', message: t('app.tasks.write.title-required', 'Give the task a title.') } };
    }
    if (title !== str(fd, 'titleBase')) input.title = title;
  }

  // Unlike the edit (whose null clears), the clone clears with the empty string the issue pins.
  if (fd.has('descriptionBase')) {
    const description = str(fd, 'description');
    if (description !== str(fd, 'descriptionBase')) input.description = description;
  }

  if (fd.has('sourceBase')) {
    const source = str(fd, 'source');
    if (source !== str(fd, 'sourceBase')) input.source = source;
  }

  if (fd.has('tagsBase')) {
    const tags = tagList(String(fd.get('tags') ?? ''));
    if (!sameList(tags, tagList(String(fd.get('tagsBase') ?? '')))) input.tags = tags;
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

  if (fd.has('cloneParentBase')) {
    const now = str(fd, 'cloneParent');
    if (now !== str(fd, 'cloneParentBase')) {
      if (now === 'none') input.parentTaskId = null;
      else if (now.startsWith('parent:')) input.parentTaskId = now.slice('parent:'.length);
      // 'project' unchanged, or anything else a crafted post sends: no parent is named, and the
      // server applies its own copy rule.
    }
  }

  // 'copied' names nothing: a copied priority the caller may not set is silently left out, so the
  // form never promises one. A named priority is judged by the server as on a create.
  const priorityChoice = str(fd, 'priority');
  if (priorityChoice && priorityChoice !== 'copied') {
    const priority = readTaskPriority(priorityChoice);
    if (typeof priority === 'object') return { invalid: priority };
    if (priority !== undefined) input.priority = priority;
  }

  // Requirements are copied, so they diff against their base like every copied field — except on
  // a backlog start, where the form hides the controls and the copy stands as it is.
  const base = readBaseRequirements(fd.get('requirementsBase'));
  if (base && str(fd, 'start') !== 'backlog') {
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
