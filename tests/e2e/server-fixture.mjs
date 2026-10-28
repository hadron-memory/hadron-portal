// Runs only as an IPC child of the local synthetic runner. Never prints credentials.
import { pathToFileURL } from 'node:url';
import { createServer as httpServer } from 'node:http';
import { resolve } from 'node:path';
const root = process.env.HADRON_E2E_SERVER_DIR;
if (!process.send || !root || process.env.NODE_ENV !== 'test') process.exit(2);
const load = (p) => import(pathToFileURL(resolve(root, p)).href);
// Outbound calls are not part of this fixture: fail closed outside loopback.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('External fixture request refused');
  return originalFetch(input, init);
};
let server, db;
try {
  ({ db } = await load('src/integrations/db/client.ts'));
  const { createServer } = await load('src/server.ts');
  const { signJwt } = await load('src/auth/jwt.ts');
  const { generateId } = await load('src/lib/id.ts');
  const user = await db.user.create({ data: {
    id: generateId(), handle: 'portal-api-key-fixture', name: 'Synthetic API key fixture',
    email: 'portal-api-key-fixture@example.invalid', roles: ['CONTRIBUTOR'],
  } });
  const app = await createServer();
  server = httpServer(app);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const token = await signJwt({ sub: user.id, roles: ['CONTRIBUTOR'] });
  process.send({ origin: `http://127.0.0.1:${server.address().port}`, token });
  process.on('message', async (message) => {
    if (message === 'cleanup') {
      // The parent also drops this entire owned database in its finally block.
      await db.userApiKey.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
      server.close();
      process.exit(0);
    }
  });
} catch {
  process.send({ error: 'Fixture startup failed' });
  await db?.$disconnect();
  server?.close();
  process.exit(1);
}
