import { GraphQLClient } from 'graphql-request';
import { env } from '$env/dynamic/private';

/** The hadron-server origin the portal's server side talks to. */
export function serverBaseUrl(): string {
  return env.LOCAL_SERVER_URL ?? 'http://localhost:4000';
}

export function gqlClient(token?: string | null): GraphQLClient {
  const url = `${serverBaseUrl()}/graphql`;
  return new GraphQLClient(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
