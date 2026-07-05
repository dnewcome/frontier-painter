// playthrough/run.mjs
//
// Self-contained orchestrator for the playthrough demo. One command, fully
// re-runnable after any change:
//
//   1. `vite build`           -> fresh production bundle in dist/
//   2. `vite preview`         -> serve dist/ on PORT (background, own group)
//   3. wait for the port to accept TCP connections
//   4. `capture.mjs`          -> drive window.game, screenshot beats, record
//                                video, transcode to demo.gif + demo.mp4
//   5. tear the server down   -> ALWAYS, even on failure
//
// RUN_LABEL defaults to "latest"; override via env (RUN_LABEL=foo) or argv
// (`npm run playthrough -- foo`). Exit code mirrors the capture result.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RUN_LABEL = process.env.RUN_LABEL || process.argv[2] || "latest";
// Which capture script to drive (default: the magnetic-boots locomotion slice).
// `playthrough:paint` sets CAPTURE_FILE=capture-paint.mjs for the paint slice.
const CAPTURE_FILE = process.env.CAPTURE_FILE || "capture.mjs";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const BASE_URL = `http://${HOST}:${PORT}`;

const bin = (name) =>
  path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`\`${cmd} ${args.join(" ")}\` exited with code ${code}`)),
    );
  });
}

function waitForPort(host, port, timeoutMs) {
  const start = Date.now();
  const tryOnce = () =>
    new Promise((res) => {
      const sock = net.connect({ host, port });
      const done = (ok) => {
        sock.removeAllListeners();
        sock.destroy();
        res(ok);
      };
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
    });
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (await tryOnce()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timed out waiting for ${host}:${port}`));
      }
      setTimeout(poll, 300);
    };
    poll();
  });
}

async function main() {
  console.log(`[run] RUN_LABEL=${RUN_LABEL}  target=${BASE_URL}`);

  // 1. Build the production bundle.
  console.log("[run] vite build...");
  await run(bin("vite"), ["build"]);

  // 2. Start the preview server in its own process group so we can reliably
  //    kill the whole tree later.
  console.log(`[run] starting vite preview on ${HOST}:${PORT}...`);
  const server = spawn(
    bin("vite"),
    ["preview", "--host", HOST, "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: "inherit", detached: true },
  );

  let serverDown = false;
  const killServer = () => {
    if (serverDown || server.pid == null) return;
    serverDown = true;
    try {
      // Negative pid => kill the whole process group.
      process.kill(-server.pid, "SIGTERM");
    } catch {
      try {
        server.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  };

  // Best-effort cleanup on unexpected exit / Ctrl-C.
  process.on("exit", killServer);
  process.on("SIGINT", () => {
    killServer();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killServer();
    process.exit(143);
  });
  server.on("exit", (code) => {
    if (!serverDown && code !== 0 && code !== null) {
      console.error(`[run] preview server exited early with code ${code}`);
    }
  });

  try {
    // 3. Wait for the server to be listening.
    await waitForPort(HOST, PORT, 60_000);
    console.log("[run] preview is up; running capture...");

    // 4. Run the capture against the live server.
    console.log(`[run] capture script: ${CAPTURE_FILE}`);
    await run(process.execPath, [path.join(__dirname, CAPTURE_FILE)], {
      env: { ...process.env, BASE_URL, RUN_LABEL },
    });
  } finally {
    // 5. Always tear the server down.
    console.log("[run] stopping preview server...");
    killServer();
  }
}

main()
  .then(() => {
    console.log("[run] done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[run] FAILED:", err && err.message ? err.message : err);
    process.exit(1);
  });
