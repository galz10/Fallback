import { createHash } from "node:crypto";

const maxAvatarBytes = 2 * 1024 * 1024;

export class AvatarCacheService {
  async cacheAccountAvatar(accountId: string, avatarUrl: string | null | undefined): Promise<string | null> {
    if (!avatarUrl) return null;
    const url = safeHttpUrl(avatarUrl);
    if (!url) return null;

    const response = await fetch(url, { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" } });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxAvatarBytes) return null;

    const cacheKey = createHash("sha256").update(`${accountId}:${url.toString()}`).digest("hex").slice(0, 32);
    return `data:${imageMimeType(contentType)};name=${cacheKey};base64,${bytes.toString("base64")}`;
  }
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function imageMimeType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() || "image/png";
}
