import { useEffect, useState } from "react";
import { useCachedImageSrc } from "../lib/image-cache";

export function Avatar({ seed, src, size = "sm" }: { seed: string; src?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizeClass = avatarSizeClass(size);
  const pixelSize = size === "lg" ? 80 : size === "md" ? 64 : 32;
  const sizedSrc = src ? sizedAvatarUrl(src, pixelSize) : undefined;
  const imageSrc = useCachedImageSrc(sizedSrc);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => {
    setFailedSrc(null);
  }, [sizedSrc]);
  const remoteLoadFailed = imageSrc === sizedSrc && failedSrc === sizedSrc;
  if (!sizedSrc || !imageSrc || remoteLoadFailed) {
    return <InitialAvatar seed={seed} size={size} />;
  }

  return (
    <img
      src={imageSrc}
      alt=""
      onError={() => {
        setFailedSrc(sizedSrc);
      }}
      className={`${sizeClass} rounded-full border border-neutral-700 bg-neutral-800 shrink-0 object-cover`}
    />
  );
}

function InitialAvatar({ seed, size = "sm" }: { seed: string; size?: "sm" | "md" | "lg" }) {
  const textClass = size === "lg" ? "text-[18px]" : size === "md" ? "text-[14px]" : "text-[11px]";
  return (
    <span
      aria-hidden="true"
      className={`${avatarSizeClass(size)} ${textClass} inline-flex shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-[#181818] font-semibold text-neutral-200 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]`}
    >
      {avatarInitial(seed)}
    </span>
  );
}

function avatarSizeClass(size: "sm" | "md" | "lg"): string {
  return size === "lg" ? "w-10 h-10" : size === "md" ? "w-8 h-8" : "w-4 h-4";
}

function avatarInitial(seed: string): string {
  return seed.trim().replace(/^@/, "")[0]?.toUpperCase() ?? "?";
}

function sizedAvatarUrl(src: string, size: number): string {
  try {
    const url = new URL(src);
    if (url.hostname === "avatars.githubusercontent.com") {
      url.searchParams.set("s", String(size));
    }
    return url.toString();
  } catch {
    return src;
  }
}
