import { UrnParseError, validateAtomShape, validateOrgSlug, validateUserSlug } from '$lib/urn/parse-urn';

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
