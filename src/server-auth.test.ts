import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { startServer } from './server.js';

// startServer prints a startup banner to stdout; under `node --test` that output can interleave with the
// runner's serialized result stream and fail the whole file ("Unable to deserialize cloned data"). Each test
// file runs in its own process, so muting console.log here affects nothing else.
console.log = () => {};

test('LAN pages do not disclose the API token; local pages retain automatic login', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vedio-auth-'));
  const token = 'test-secret-that-must-not-be-public';
  try {
    // If a regression lets this start, close it so the test fails instead of hanging on the open socket.
    await assert.rejects(startServer({ port: 0, host: '0.0.0.0', token: '', projectsDir: dir }).then(s => { s.close(); return s; }));
    for (const host of ['0.0.0.0', '127.0.0.1']) {
      const server = await startServer({ port: 0, host, token, projectsDir: dir });
      try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const html = await (await fetch(base)).text();
        assert.equal(html.includes(token), host === '127.0.0.1');
        assert.ok(html.includes('window.__PIPELINE_AUTH_REQUIRED__=true'));
        assert.equal((await fetch(base + '/api/projects')).status, 401);
        assert.equal((await fetch(base + '/api/projects', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit loopback no-auth mode does not ask for a nonexistent token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vedio-open-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', token: '', projectsDir: dir });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.ok((await (await fetch(base)).text()).includes('window.__PIPELINE_AUTH_REQUIRED__=false'));
    assert.equal((await fetch(base + '/api/projects')).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
