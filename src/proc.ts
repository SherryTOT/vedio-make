/**
 * Async subprocess runner — the single place the pipeline shells out.
 *
 * Replaces the old synchronous `spawnSync` helper that lived in render.ts.
 * `spawnSync` blocks the entire Node event loop until the child exits, so when
 * the HTTP daemon rendered a video it could not answer ANY request (task
 * polling, /api/health) for the whole render — the UI appeared frozen.
 *
 * This runner uses `spawn` (non-blocking) and adds two things the daemon needs:
 *   1. A watchdog timeout that kills the WHOLE process group (npx → node →
 *      chrome) so a stalled render fails fast instead of hanging for minutes.
 *   2. Line-streamed output via `onLine`, so the server can forward subprocess
 *      progress into a task's live log.
 *
 * Process-group kill: children are spawned `detached` (own process group), so
 * `process.kill(-pid, sig)` signals the leader AND its descendants. We send
 * SIGTERM first, then SIGKILL after a short grace period.
 */
import { spawn } from "node:child_process";
import path from "node:path";

export interface RunOpts {
  cwd: string;
  /** Kill the process group after this many ms. 0 / undefined = no timeout. */
  timeoutMs?: number;
  /** Human label for log + error messages (defaults to the command). */
  label?: string;
  /** Called once per output line (stdout + stderr merged). */
  onLine?: (line: string) => void;
  /** Extra env on top of process.env. */
  env?: NodeJS.ProcessEnv;
}

/** Grace period between SIGTERM and SIGKILL when a timeout fires. */
const KILL_GRACE_MS = 3000;
/** How many trailing output lines to keep for the error message. */
const TAIL_LINES = 40;

function killGroup(pid: number, sig: NodeJS.Signals): void {
  // Negative pid → signal the whole process group (requires detached spawn).
  try {
    process.kill(-pid, sig);
  } catch {
    // Group already gone, or never became a leader — fall back to the pid.
    try {
      process.kill(pid, sig);
    } catch {
      /* already dead */
    }
  }
}

/**
 * Run a command to completion. Resolves on exit code 0, rejects otherwise
 * (non-zero exit, spawn error, or timeout). Never blocks the event loop.
 */
export function run(cmd: string, args: string[], opts: RunOpts): Promise<void> {
  const label = opts.label ?? `${cmd} ${args.slice(0, 3).join(" ")}`;
  const cwdRel = path.relative(process.cwd(), opts.cwd) || ".";

  return new Promise<void>((resolve, reject) => {
    const sink = opts.onLine ?? ((l: string) => process.stdout.write(l + "\n"));
    sink(`[run] ${cmd} ${args.join(" ")}  (cwd=${cwdRel})`);

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      detached: true, // own process group → we can kill the whole npx→node→chrome tree
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

    const tail: string[] = [];
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const pump = (chunk: Buffer) => {
      for (const raw of chunk.toString("utf8").split(/\r?\n/)) {
        const line = raw.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""); // strip ANSI
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
        sink(line);
      }
    };
    child.stdout?.on("data", pump);
    child.stderr?.on("data", pump);

    const watchdog =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              sink(`[run] ⏱ ${label} exceeded ${Math.round(opts.timeoutMs! / 1000)}s — terminating process group`);
              killGroup(child.pid, "SIGTERM");
              killTimer = setTimeout(() => {
                if (child.pid) killGroup(child.pid, "SIGKILL");
              }, KILL_GRACE_MS);
            }
          }, opts.timeoutMs)
        : undefined;

    const cleanup = () => {
      if (watchdog) clearTimeout(watchdog);
      if (killTimer) clearTimeout(killTimer);
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`无法启动 ${label}: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) {
        return reject(
          new Error(`${label} 超时(>${Math.round((opts.timeoutMs ?? 0) / 1000)}s)已被终止。` + tailMsg(tail)),
        );
      }
      if (code === 0) return resolve();
      const how = signal ? `signal ${signal}` : `exit ${code}`;
      reject(new Error(`${label} 失败(${how})。` + tailMsg(tail)));
    });
  });
}

/**
 * Run a command and capture its stdout (for short capability probes like
 * `ffmpeg -filters`). Resolves with { code, stdout } and never rejects on a
 * non-zero exit — the caller inspects the result.
 */
export function runCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      resolve({ code, stdout: out, stderr: err });
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return finish(null);
    }
    const t =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            try { child.kill("SIGKILL"); } catch {}
            finish(null);
          }, opts.timeoutMs)
        : undefined;
    child.stdout?.on("data", (c) => (out += c.toString("utf8")));
    child.stderr?.on("data", (c) => (err += c.toString("utf8")));
    child.on("error", () => { if (t) clearTimeout(t); finish(null); });
    child.on("close", (code) => { if (t) clearTimeout(t); finish(code); });
  });
}

function tailMsg(tail: string[]): string {
  if (!tail.length) return "";
  return `\n  ── 末尾输出 ──\n  ${tail.slice(-12).join("\n  ")}`;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
