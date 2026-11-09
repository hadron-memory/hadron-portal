/**
 * #1647: a followed 307/308 re-sends the POST body, so a redirected mutation would be delivered
 * twice. These run real fetch against a real loopback server: a mocked fetch never follows a
 * redirect, so it could not show the replay at all.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GraphQLClient } from 'graphql-request';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ LOCAL_SERVER_URL: '' }));
vi.mock('$env/dynamic/private', () => ({ env }));
import { gqlClient } from './api';

const MUTATION = /* GraphQL */ `mutation Save($input: UpdateNodeInput!) { saved: updateNode(input: $input) { id } }`;
const VARIABLES = { input: { id: 'n' } };
const QUERY = /* GraphQL */ `query Read { me { id } }`;
const DATA = { saved: { id: 'n' } };

type Hit = { method: string; url: string; body: string; authorization?: string; contentType?: string };

let server: Server;
let origin: string;
let hits: Hit[];
let redirectStatus: number | null;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      hits.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString(),
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
      });
      if (redirectStatus !== null && req.url === '/graphql') {
        res.writeHead(redirectStatus, { location: '/moved' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: DATA }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env.LOCAL_SERVER_URL = origin;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  hits = [];
  redirectStatus = null;
});

describe('gqlClient redirect policy (#1647)', () => {
  it.each([307, 308])('a mutation answered with %i fails once and is not replayed', async (status) => {
    redirectStatus = status;
    await expect(gqlClient('token').request(MUTATION, VARIABLES)).rejects.toThrow();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ method: 'POST', url: '/graphql' });
  });

  it.each([307, 308])('rawRequest answered with %i fails once and is not replayed', async (status) => {
    redirectStatus = status;
    await expect(gqlClient('token').rawRequest(MUTATION, VARIABLES)).rejects.toThrow();
    expect(hits).toHaveLength(1);
  });

  it.each([301, 302])('a %i is not followed either, so no request reaches the new location', async (status) => {
    redirectStatus = status;
    await expect(gqlClient('token').request(QUERY)).rejects.toThrow();
    expect(hits.map((hit) => hit.url)).toEqual(['/graphql']);
  });

  // The other direction: the same server against a client without the policy delivers the body
  // twice. Without this, the pins above would also pass on a server that never redirected.
  it.each([307, 308])('a client that follows %i delivers the same mutation twice', async (status) => {
    redirectStatus = status;
    const following = new GraphQLClient(`${origin}/graphql`);
    await expect(following.request(MUTATION, VARIABLES)).resolves.toEqual(DATA);
    expect(hits.map((hit) => hit.url)).toEqual(['/graphql', '/moved']);
    expect(hits[1].body).toBe(hits[0].body);
  });

  it('an unredirected mutation keeps its path, method, body and bearer header', async () => {
    await expect(gqlClient('token').request(MUTATION, VARIABLES)).resolves.toEqual(DATA);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ method: 'POST', url: '/graphql', authorization: 'Bearer token' });
    expect(hits[0].contentType).toContain('application/json');
    expect(JSON.parse(hits[0].body)).toMatchObject({ query: MUTATION, variables: VARIABLES });
  });

  it('forwards an abort signal instead of issuing an already-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(gqlClient('token', controller.signal).request(QUERY)).rejects.toThrow();
    expect(hits).toHaveLength(0);
  });

  it('a client without a token sends no Authorization header', async () => {
    await gqlClient().request(QUERY);
    expect(hits[0].authorization).toBeUndefined();
  });
});
