export function renderableAvatarUrl(cachedUrl: string | null | undefined, remoteUrl: string | null | undefined): string | undefined {
  if (isRenderableAvatarUrl(cachedUrl)) return cachedUrl;
  if (isRenderableAvatarUrl(remoteUrl)) return remoteUrl;
  return undefined;
}

function isRenderableAvatarUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  return value.startsWith("data:image/") || value.startsWith("https://") || value.startsWith("http://");
}
