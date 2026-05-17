import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

const host = process.env.FALLBACK_DEV_HOST?.trim() || "127.0.0.1";
const preferredPort = Number.parseInt(process.env.FALLBACK_DEV_PORT || "5173", 10);
const strictPort = process.env.FALLBACK_STRICT_DEV_PORT === "1";
const maxPort = strictPort ? preferredPort : preferredPort + 20;

if (!Number.isInteger(preferredPort) || preferredPort <= 0 || preferredPort > 65535) {
  throw new Error(`Invalid FALLBACK_DEV_PORT: ${process.env.FALLBACK_DEV_PORT}`);
}

const port = await choosePort(preferredPort, maxPort);
const devServerUrl = `http://${host}:${port}`;
const children = new Set<ChildProcess>();
let shuttingDown = false;

if (port !== preferredPort) {
  console.log(`[dev] Port ${preferredPort} is in use; using ${port}. Set FALLBACK_STRICT_DEV_PORT=1 to fail instead.`);
}

const vite = spawnTracked("pnpm", ["exec", "vite", "--host", host, "--port", String(port), "--strictPort"], {
  VITE_DEV_SERVER_URL: devServerUrl
});

try {
  await waitForPort(host, port, 30_000);
  await runOnce("pnpm", ["build:electron"]);
  const electron = spawnTracked("pnpm", ["exec", "electron", "."], {
    VITE_DEV_SERVER_URL: devServerUrl
  });

  electron.once("exit", (code, signal) => {
    cleanup();
    exitFromChild(code, signal);
  });

  vite.once("exit", (code, signal) => {
    if (shuttingDown) return;
    cleanup();
    exitFromChild(code, signal);
  });
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});

process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function choosePort(start: number, end: number): Promise<number> {
  for (let candidate = start; candidate <= end; candidate += 1) {
    if (await isPortFree(host, candidate)) return candidate;
  }
  throw new Error(`No free dev server port found from ${start} to ${end}.`);
}

function isPortFree(listenHost: string, listenPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(listenPort, listenHost);
  });
}

function waitForPort(connectHost: string, connectPort: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: connectHost, port: connectPort });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite at http://${connectHost}:${connectPort}.`));
          return;
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function runOnce(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code ?? "unknown status"}.`));
    });
  });
}

function spawnTracked(command: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function cleanup(): void {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

function exitFromChild(code: number | null, signal: NodeJS.Signals | null): never {
  if (signal === "SIGINT") process.exit(130);
  if (signal === "SIGTERM") process.exit(143);
  process.exit(code ?? 1);
}
