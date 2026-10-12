import {
  UrnParseError,
  parseUrnInput,
  validateAtomShape,
  validateOrgSlug,
  validateUserSlug,
} from '$lib/urn/parse-urn';
import { t } from '$lib/i18n/t';

type SlugValidator = (value: string) => void;

function messageForError(error: unknown, label: string, fallback: string): string {
  if (!(error instanceof UrnParseError)) return fallback;
  switch (error.reason) {
    case 'reserved-word-slug':
      return `${label} is reserved. Choose a different value.`;
    case 'invalid-charset':
      return `${label} may use lowercase letters, numbers, dots, underscores, and hyphens, and must start and end with a letter or number.`;
    case 'slug-not-lowercase':
      return `${label} must be lowercase.`;
    case 'slug-too-long':
      return `${label} must be 64 characters or fewer.`;
    case 'invalid-segment-shape':
      return `${label} must start and end with a letter or number.`;
    case 'root-id-shaped':
      // #1061: urn-lib-js refuses a root that looks like an entity id (32 hex or
      // a cuid), because a ref in that shape is looked up as a primary key.
      return t('urn.rootIdShaped', '{label} must not look like an ID. Choose a different name.', { label });
    case 'org-urn-not-bare':
      return `${label} must be a bare slug, not a full hrn:org: URN.`;
    default:
      return fallback;
  }
}

function validateSlugField(
  value: string,
  label: string,
  requiredMessage: string,
  validate: SlugValidator,
): string | null {
  const slug = value.trim();
  if (!slug) return requiredMessage;
  try {
    validate(slug);
    return null;
  } catch (error: unknown) {
    return messageForError(error, label, `Invalid ${label.toLowerCase()}.`);
  }
}

export function validateHandleField(value: string): string | null {
  const handle = value.trim();
  if (!handle) return null;
  return validateSlugField(handle, 'Handle', '', validateUserSlug);
}

export function validateMemorySlugField(value: string): string | null {
  return validateSlugField(
    value,
    'Memory URN slug',
    'URN slug is required.',
    (slug) => validateAtomShape(slug, slug),
  );
}

export function validateOrgSlugField(value: string): string | null {
  return validateSlugField(value, 'Organization URN', 'Organization URN is required.', validateOrgSlug);
}

// Reduce a memory URN form value to the BARE memory slug the server's
// updateMemory expects. The edit field is meant to hold just the slug, but a
// user may paste a full or partial URN; normalize the common display forms so
// validation and actions share one grammar.
//
// `parseUrnInput` strips the scheme + type word and normalizes the grammar-v2
// `mem` type word to `memory` (#697 emission flip) — the old hand-rolled regex
// missed `mem` and split only on `::`, so a pasted v2 memory URN
// (`hrn:mem:<root>:<slug>`, single colon) fell through unstripped.
export function toBareMemorySlugInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const { value } = parseUrnInput(trimmed);
  // v1 hierarchy grammar: `<org>::<slug>[::…]` — the memory slug is segment 2.
  if (value.includes('::')) {
    return value.split('::')[1] ?? '';
  }
  // v2 flat grammar: `<root>:<slug>` (the slug is a single terminal atom after
  // the pool root). A bare single-atom slug (no root) is returned unchanged.
  const atoms = value.split(':');
  return atoms.length >= 2 ? (atoms[atoms.length - 1] ?? '') : value;
}
