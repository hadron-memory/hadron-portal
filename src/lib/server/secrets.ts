import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';

/**
 * portal#2380 — App secrets (hadron-server#3999 S4, built against frozen head 71997f19).
 * Only an App's secrets are handled here: protection exists on App secrets only
 * (hrn:node:hadronmemory.com:specs:cor:sec:070). A secret's VALUE is write-only: no read
 * returns it, and nothing in this module selects one.
 */
const SECRET_FIELDS = /* GraphQL */ `
  fragment SecretFields on Secret {
    id ownerType ownerId name kind protected deleteAfterUse currentVersion metadata createdAt createdBy updatedAt updatedBy
  }
`;

export const APP_SECRETS_QUERY = /* GraphQL */ `
  ${SECRET_FIELDS}
  query AppSecrets($ownerRef: ID!, $limit: Int, $offset: Int) {
    secrets(ownerType: "app", ownerRef: $ownerRef, limit: $limit, offset: $offset) { total items { ...SecretFields } }
  }
`;
export const SECRET_QUERY = /* GraphQL */ `
  ${SECRET_FIELDS}
  query AppSecret($ref: ID!) { secret(ref: $ref) { ...SecretFields } }
`;
export const SECRET_CHANGE_REQUEST_QUERY = /* GraphQL */ `
  query SecretChangeRequestState($id: ID!) { secretChangeRequest(id: $id) { id state operation createdAt expiresAt } }
`;
export const CREATE_SECRET_MUTATION = /* GraphQL */ `
  ${SECRET_FIELDS}
  mutation CreateAppSecret($ownerRef: ID!, $name: String!, $kind: String!, $value: JSON!, $protected: Boolean) {
    createSecret(ownerType: "app", ownerRef: $ownerRef, name: $name, kind: $kind, value: $value, protected: $protected) { ...SecretFields }
  }
`;
export const UPDATE_SECRET_VALUE_MUTATION = /* GraphQL */ `
  ${SECRET_FIELDS}
  mutation UpdateAppSecretValue($ref: ID!, $value: JSON!) { updateSecret(ref: $ref, value: $value) { ...SecretFields } }
`;
export const UPDATE_SECRET_DELETE_AFTER_USE_MUTATION = /* GraphQL */ `
  ${SECRET_FIELDS}
  mutation UpdateAppSecretDeleteAfterUse($ref: ID!, $deleteAfterUse: Boolean!) { updateSecret(ref: $ref, deleteAfterUse: $deleteAfterUse) { ...SecretFields } }
`;
export const SET_SECRET_PROTECTED_MUTATION = /* GraphQL */ `
  ${SECRET_FIELDS}
  mutation SetSecretProtected($ref: ID!, $protected: Boolean!) { setSecretProtected(ref: $ref, protected: $protected) { ...SecretFields } }
`;
export const DELETE_SECRET_MUTATION = /* GraphQL */ `
  mutation DeleteAppSecret($ref: ID!) { deleteSecret(ref: $ref) }
`;
export const WITHDRAW_CHANGE_REQUEST_MUTATION = /* GraphQL */ `
  mutation WithdrawSecretChangeRequest($id: ID!) { withdrawSecretChangeRequest(id: $id) }
`;

export interface AppSecret {
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  kind: string;
  /** The non-secret, inspectable half of the secret (never a value). */
  metadata: unknown;
  protected: boolean;
  /** Whether a read client's auto-delete mark may delete this secret after its use (hrn:node:hadronmemory.com:specs:cor:sec:060:03). */
  deleteAfterUse: boolean;
  currentVersion: number | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export type SecretsRead =
  | { kind: 'ok'; secrets: AppSecret[]; total: number }
  | { kind: 'failed' };

export const SECRETS_PAGE = 200;
/** The most pages one list read walks: 2,000 secrets. Past that the page says how many it shows. */
export const SECRETS_MAX_PAGES = 10;

/**
 * Why a read failed, for the log: the server's error code when it sent one and it is code-shaped,
 * else a fixed marker. Never the message, the variables or anything the wire carried.
 */
function readFailureCode(e: unknown): string {
  const code = extractGqlErrorCode(e);
  return code && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : code ? 'unrecognized' : 'no-code';
}
function logReadFailure(op: string, e: unknown) {
  console.error('[secrets] read failed:', { op, code: readFailureCode(e) });
}

/** Every page up to SECRETS_MAX_PAGES: `total` is the server's count, so a capped list is shown as capped. */
export async function loadAppSecrets(client: Pick<GraphQLClient, 'request'>, appId: string): Promise<SecretsRead> {
  const secrets: AppSecret[] = [];
  let total = 0;
  try {
    for (let page = 0; page < SECRETS_MAX_PAGES; page++) {
      const r = await client.request<{ secrets: { total: number; items: AppSecret[] } }>(APP_SECRETS_QUERY, { ownerRef: appId, limit: SECRETS_PAGE, offset: page * SECRETS_PAGE });
      secrets.push(...r.secrets.items);
      total = r.secrets.total;
      if (r.secrets.items.length === 0 || secrets.length >= total) break;
    }
  } catch (e) {
    logReadFailure('app-secrets', e);
    return { kind: 'failed' };
  }
  return { kind: 'ok', secrets, total };
}

export type SecretRead = { kind: 'ok'; secret: AppSecret } | { kind: 'missing' } | { kind: 'failed' };

/** An absent secret, a secret of another owner and one the viewer may not see all read as missing. */
export async function loadAppSecret(client: Pick<GraphQLClient, 'request'>, appId: string, ref: string): Promise<SecretRead> {
  try {
    const r = await client.request<{ secret: AppSecret | null }>(SECRET_QUERY, { ref });
    const s = r.secret;
    return s && s.ownerType === 'app' && s.ownerId === appId ? { kind: 'ok', secret: s } : { kind: 'missing' };
  } catch (e) {
    // The server may refuse the read outright for a secret the viewer may not see: that is "missing", not a fault.
    // Logged by its code (never the message) so a real permission fault is still visible in the logs.
    const code = extractGqlErrorCode(e);
    if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
      console.error('[secrets] read refused:', { op: 'app-secret', code });
      return { kind: 'missing' };
    }
    logReadFailure('app-secret', e);
    return { kind: 'failed' };
  }
}

export interface ChangeRequestState { id: string; state: string; operation: string; createdAt: string; expiresAt: string }

/** null: the server does not show this request to the viewer (not theirs, or gone). */
export async function loadChangeRequest(client: Pick<GraphQLClient, 'request'>, id: string): Promise<ChangeRequestState | null | 'failed'> {
  try {
    const r = await client.request<{ secretChangeRequest: ChangeRequestState | null }>(SECRET_CHANGE_REQUEST_QUERY, { id });
    return r.secretChangeRequest;
  } catch (e) {
    logReadFailure('change-request', e);
    return 'failed';
  }
}

/**
 * Whether this deployment signs. Where signing is off, `secretChangeRequest`,
 * `setSecretProtected` and `withdrawSecretChangeRequest` are ABSENT from the schema, and
 * introspection is refused in production, so the probe asks for the field: a deployment
 * without it fails validation, one with it answers null for an id that is not the viewer's.
 * Anything else is "unknown", which the page treats as off: the toggle stays hidden.
 */
export type SigningState = 'on' | 'off' | 'unknown';
export async function probeSigning(client: Pick<GraphQLClient, 'request'>): Promise<SigningState> {
  try {
    await client.request(SECRET_CHANGE_REQUEST_QUERY, { id: 'signing-probe' });
    return 'on';
  } catch (e) {
    return extractGqlErrorCode(e) === 'GRAPHQL_VALIDATION_FAILED' ? 'off' : 'unknown';
  }
}
