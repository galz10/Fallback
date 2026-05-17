import { execFile, spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import type { LocalChangePatch } from "../../../src/shared/domain/local-git.js";
import { gitText } from "../git-command.js";
import { inspectRepoPath } from "../repo-path-safety.js";
import type { StatusEntry } from "./git-status-parser.js";

export const localChangePreviewMaxBytes = 1_000_000;

export const localChangePreviewSampleBytes = 8_192;

export async function localChangeFilePreview(cwd: string, entry: StatusEntry): Promise<NonNullable<LocalChangePatch["preview"]>> {
  const inspectedPath = inspectRepoPath(cwd, entry.path);
  if (inspectedPath.kind === "outside") {
    return previewState(entry, "permission_error", null, null, "File path is outside the repository.");
  }
  if (inspectedPath.kind === "symlink") {
    return previewState(entry, "permission_error", null, inspectedPath.stat.size, "Symlink targets are not read in inline previews.");
  }
  const stat = inspectedPath.kind === "file" ? inspectedPath.stat : null;
  const currentSize = stat?.size ?? null;
  const currentTooLarge = currentSize != null && currentSize > localChangePreviewMaxBytes;
  const previousRef = `HEAD:${entry.previousPath ?? entry.path}`;
  const previousSize = await gitObjectSize(cwd, previousRef).catch(() => null);
  const previousTooLarge = previousSize != null && previousSize > localChangePreviewMaxBytes;
  const [currentBuffer, currentSample, previousBuffer, previousSample] = await Promise.all([
    inspectedPath.kind === "file" && !currentTooLarge ? readFile(inspectedPath.absolutePath).catch(() => null) : Promise.resolve(null),
    inspectedPath.kind === "file" ? fileHeaderBuffer(inspectedPath.absolutePath).catch(() => null) : Promise.resolve(null),
    !previousTooLarge ? gitObjectBuffer(cwd, previousRef).catch(() => null) : Promise.resolve(null),
    gitObjectHeaderBuffer(cwd, previousRef).catch(() => null)
  ]);
  const bufferForDetection = currentSample ?? previousSample ?? currentBuffer ?? previousBuffer;
  const isLfsPointer = bufferForDetection ? lfsPointer(bufferForDetection) : false;
  const isBinary = bufferForDetection ? binaryBuffer(bufferForDetection) : false;
  const mimeType = imageMime(entry.path);
  const isImage = Boolean(mimeType);
  const isTooLarge =
    currentTooLarge ||
    previousTooLarge ||
    (currentSize ?? previousSize ?? currentBuffer?.length ?? previousBuffer?.length ?? 0) > localChangePreviewMaxBytes;
  const kind = isLfsPointer
    ? "lfs"
    : isTooLarge
      ? "too_large"
      : isImage
        ? "image"
        : isBinary
          ? "binary"
          : entry.status === "deleted"
            ? "deleted"
            : "text";
  return {
    kind,
    path: entry.path,
    previousPath: entry.previousPath,
    mimeType,
    fileSize: currentSize ?? previousSize ?? currentBuffer?.length ?? previousBuffer?.length ?? null,
    isImage,
    isBinary,
    isLfsPointer,
    isGenerated: generatedPath(entry.path),
    isTooLarge,
    currentDataUrl: isImage && currentBuffer && !isTooLarge ? dataUrl(mimeType, currentBuffer) : null,
    previousDataUrl: isImage && previousBuffer && !isTooLarge ? dataUrl(mimeType, previousBuffer) : null,
    message: previewMessage(kind, entry.path)
  };
}

export function previewState(
  entry: StatusEntry,
  kind: NonNullable<LocalChangePatch["preview"]>["kind"],
  mimeType: string | null,
  fileSize: number | null,
  message: string | null
): NonNullable<LocalChangePatch["preview"]> {
  return {
    kind,
    path: entry.path,
    previousPath: entry.previousPath,
    mimeType,
    fileSize,
    isImage: Boolean(mimeType),
    isBinary: kind === "binary",
    isLfsPointer: kind === "lfs",
    isGenerated: generatedPath(entry.path),
    isTooLarge: kind === "too_large",
    currentDataUrl: null,
    previousDataUrl: null,
    message
  };
}

export function previewMessage(kind: NonNullable<LocalChangePatch["preview"]>["kind"], filePath: string): string | null {
  if (kind === "image") return "Image preview loaded from the worktree and HEAD where available.";
  if (kind === "binary") return "Binary file. Inline text diff is not available.";
  if (kind === "lfs") return "Git LFS pointer file. Avoid editing the pointer manually.";
  if (kind === "too_large") return "File is too large for an inline preview.";
  if (kind === "deleted") return `${filePath} is deleted in the worktree.`;
  return null;
}

export function imageMime(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  return null;
}

export function dataUrl(mimeType: string | null, buffer: Buffer): string | null {
  if (!mimeType) return null;
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function binaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

export function lfsPointer(buffer: Buffer): boolean {
  const text = buffer.subarray(0, Math.min(buffer.length, 200)).toString("utf8");
  return text.startsWith("version https://git-lfs.github.com/spec/v1");
}

export function generatedPath(filePath: string): boolean {
  return /(^|\/)(dist|build|coverage|vendor|node_modules|generated)(\/|$)|(\.min\.(js|css)$)|(^|\/)package-lock\.json$/i.test(filePath);
}

export function gitObjectBuffer(cwd: string, objectRef: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, "show", objectRef],
      { encoding: "buffer", maxBuffer: 12 * 1024 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.toString("utf8").trim() || error.message));
        else resolve(stdout);
      }
    );
  });
}

export async function fileHeaderBuffer(filePath: string, maxBytes = localChangePreviewSampleBytes): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function gitObjectSize(cwd: string, objectRef: string): Promise<number | null> {
  const size = Number(await gitText(cwd, ["cat-file", "-s", objectRef], 30_000));
  return Number.isFinite(size) ? size : null;
}

export function gitObjectHeaderBuffer(cwd: string, objectRef: string, maxBytes = localChangePreviewSampleBytes): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, "cat-file", "blob", objectRef], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const settle = (value: Buffer | Error) => {
      if (settled) return;
      settled = true;
      if (value instanceof Error) reject(value);
      else resolve(value);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      const remaining = maxBytes - totalBytes;
      if (remaining <= 0) {
        child.kill();
        return;
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(slice);
      totalBytes += slice.length;
      if (totalBytes >= maxBytes) {
        settle(Buffer.concat(chunks, totalBytes));
        child.kill();
      }
    });
    child.on("error", settle);
    child.on("close", (code) => {
      if (settled) return;
      if (code === 0) settle(Buffer.concat(chunks, totalBytes));
      else reject(new Error(`Could not read ${objectRef}.`));
    });
  });
}
