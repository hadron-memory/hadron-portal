/**
 * Convert a display name to a URL-safe kebab slug.
 * Handles camelCase, PascalCase, abbreviations, and special characters.
 *
 * "MM Coding Agent"    → "mm-coding-agent"
 * "MMCodingAgent"      → "mm-coding-agent"
 * "My Knowledge Base"  → "my-knowledge-base"
 * "SecureID Service"   → "secure-id-service"
 */
export function toSlug(name: string): string {
  return name
    // Insert dash before uppercase runs: "MMCoding" → "MM-Coding", "SecureID" → "Secure-ID"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    // Insert dash between lower/digit and upper: "myName" → "my-Name"
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    // Remove anything that's not alphanumeric, space, or dash
    .replace(/[^a-z0-9\s-]/g, '')
    // Replace spaces with dashes
    .replace(/\s+/g, '-')
    // Collapse multiple dashes
    .replace(/-+/g, '-')
    // Trim leading/trailing dashes
    .replace(/^-|-$/g, '');
}
