import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Guards the loopback fix in setup-e2e.ts (diagnosed 2026-10-20).
 *
 * Recreates the collision behind the intermittent local e2e 401s and 404s:
 * another process owns 127.0.0.1:P while the app under test is bound to `::`
 * on the same P. Unpatched, supertest connects to 127.0.0.1:P and reaches the
 * other server. Where the OS refuses that bind (Linux), the collision can't
 * happen and the test is skipped.
 */
describe('supertest loopback (e2e harness)', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))),
    );
  });

  const serve = (status: number, body: string) =>
    createServer((_req, res) => {
      res.statusCode = status;
      res.end(body);
    });

  it('reaches the app under test even when another process shares its port on 127.0.0.1', async (ctx) => {
    const other = serve(401, 'another process');
    servers.push(other);
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const port = (other.address() as AddressInfo).port;

    const app = serve(200, 'app under test');
    const bound = await new Promise<boolean>((done) => {
      app.once('error', () => done(false));
      app.listen(port, () => done(true)); // no host: `::`, as supertest does
    });
    if (!bound) ctx.skip(); // this OS refuses the overlapping bind
    servers.push(app);

    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toBe('app under test');
  });
});
