import { GraphQLClient } from 'graphql-request';
import { env } from '$env/dynamic/private';

export function gqlClient(token?: string | null): GraphQLClient {
  const url = `${env.CONTROLLER_URL ?? 'http://localhost:4000'}/graphql`;
  return new GraphQLClient(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
