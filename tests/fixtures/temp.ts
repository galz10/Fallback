import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withTempDir<T>(prefix: string, run: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(tempDir);
  } finally {
    await removeTempDir(tempDir);
  }
}

export async function removeTempDir(tempDir: string): Promise<void> {
  const retryableCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(tempDir, { force: true, recursive: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isNodeErrorCode(error, retryableCodes)) break;
      await new Promise((resolve) => setTimeout(resolve, 50 + attempt * 50));
    }
  }

  throw lastError;
}

function isNodeErrorCode(error: unknown, codes: Set<string>): boolean {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.has(error.code);
}
