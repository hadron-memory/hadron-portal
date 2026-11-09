/**
 * Test-only field-selection check. This initial raw-text implementation exists
 * to pin the old false greens before the structural implementation replaces it.
 */
export function selectsFieldPath(query: string, _operationName: string, path: readonly string[]): boolean {
  const field = path.at(-1);
  return field !== undefined && new RegExp(`\\b${field}\\b`).test(query);
}
