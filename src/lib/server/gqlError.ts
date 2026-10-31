// Public error-envelope logic has no server secrets and is shared with the
// client-safe refusal translators. Keep this existing import path for callers.
export * from '$lib/gql-error';
