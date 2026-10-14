import { Kind, parse } from 'graphql';
import { serverBaseUrl } from '$lib/server/api';

/**
 * portal#1022 gate — does this deployment offer node signing?
 *
 * `ServerInfo.signing` is TRUE-ONLY (hadron-server#1918): while signing is off,
 * `deploymentSchema()` removes the field — and `Node.signatureStatus` with it —
 * so SELECTING either fails GraphQL validation. Selecting the discovery field
 * would just swap one failing query for another, and introspection is off in
 * production. So the answer comes from schema discovery instead: the
 * authenticated SDL route (hadron-server#499), which serves the deployment's
 * own schema. Signing is on exactly when `type ServerInfo` declares `signing`.
 *
 * The answer is a deployment fact, identical for every authenticated caller,
 * so it is cached per portal process. The switches need a server restart, which
 * the portal cannot observe; the TTL bounds how long a flip goes unseen.
 *
 * Fail closed: a refused route, a network failure or unparseable SDL all read
 * as OFF, which renders nothing — what a failed signature read rendered before
 * this gate. Failures are cached too, so a broken route is not probed per view.
 */
export const SIGNING_CAPABILITY_TTL_MS = 60_000;

let cached: { value: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

export function deploymentOffersSigning(token: string | null | undefined): Promise<boolean> {
  if (!token) return Promise.resolve(false);
  if (cached && Date.now() - cached.at < SIGNING_CAPABILITY_TTL_MS) return Promise.resolve(cached.value);
  inflight ??= probe(token).then((value) => {
    cached = { value, at: Date.now() };
    inflight = null;
    return value;
  });
  return inflight;
}

async function probe(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverBaseUrl()}/graphql/schema`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[signing-capability] schema discovery answered ${res.status}; treating signing as off`);
      return false;
    }
    return serverInfoDeclaresSigning(await res.text());
  } catch (e) {
    console.warn('[signing-capability] schema discovery failed; treating signing as off:', e);
    return false;
  }
}

function serverInfoDeclaresSigning(sdl: string): boolean {
  return parse(sdl).definitions.some(
    (d) =>
      d.kind === Kind.OBJECT_TYPE_DEFINITION &&
      d.name.value === 'ServerInfo' &&
      (d.fields ?? []).some((f) => f.name.value === 'signing'),
  );
}
