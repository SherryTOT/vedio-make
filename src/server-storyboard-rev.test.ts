import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { startServer } from "./server.ts";

// startServer prints a banner to stdout, which can corrupt node --test's result stream (see server-auth.test.ts).
console.log = () => {};

test("storyboard PUT is refused when someone else wrote since the client read it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vedio-rev-"));
  const dir = path.join(root, "demo-abc123");
  fs.mkdirSync(path.join(dir, "output"), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id: "abc123", title: "demo", dir, createdAt: 0 }));
  const sbPath = path.join(dir, "output", "storyboard.json");
  const board = (text: string, status = "pending") =>
    ({ project: { design: { presetId: "inkwork" } }, scenes: [{ index: 1, text, status }] });
  fs.writeFileSync(sbPath, JSON.stringify(board("原始")));

  const server = await startServer({ port: 0, host: "127.0.0.1", token: "", projectsDir: root });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/abc123`;
  const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const put = (body: unknown) => fetch(`${base}/storyboard`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    // Both read paths the UI uses hand out a rev.
    const read = await json(fetch(`${base}/storyboard`));
    assert.match(read.rev, /^[0-9a-f]{16}$/);
    assert.equal((await json(fetch(base))).storyboard.rev, read.rev);

    // Saving against the rev you read succeeds, returns the new rev, and never stores rev on disk.
    const ok = await put({ ...board("我改的"), rev: read.rev });
    assert.equal(ok.status, 200);
    const { rev: rev2 } = await json(ok);
    assert.notEqual(rev2, read.rev);
    assert.equal("rev" in JSON.parse(fs.readFileSync(sbPath, "utf8")), false);

    // The race: the render process writes the file after the board read it…
    fs.writeFileSync(sbPath, JSON.stringify(board("我改的", "rendered")));
    // …so a save carrying the old rev must be refused instead of wiping the render's status.
    const stale = await put({ ...board("又改了"), rev: rev2 });
    assert.equal(stale.status, 409);
    assert.equal((await json(stale)).code, "stale");
    assert.equal(JSON.parse(fs.readFileSync(sbPath, "utf8")).scenes[0].status, "rendered");

    // A PUT without rev (curl / older clients) still works as before.
    assert.equal((await put(board("无版本号"))).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
