import type { JSX } from "react";
import { MarkGithubIcon } from "@primer/octicons-react";

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "./ui/avatar";

type ProviderAvatarProps = {
  size?: number;
  username?: string | null;
  src?: string | null;
  title?: string;
  showProviderBadge?: boolean;
};

export function GitHubAvatar({ size = 32, username, src, title, showProviderBadge = true }: ProviderAvatarProps): JSX.Element {
  const handle = cleanUsername(username);
  const fallback = initials(handle ?? "GH");
  const imageSrc = src ?? (handle ? `https://github.com/${handle}.png?size=${size * 2}` : undefined);

  return (
    <Avatar className="overflow-visible" title={title ?? handle ?? "GitHub"} style={{ width: size, height: size }}>
      <AvatarImage src={imageSrc} alt={handle ? `@${handle}` : "GitHub"} className="rounded-full" />
      <AvatarFallback>{fallback}</AvatarFallback>
      {showProviderBadge && (
        <AvatarBadge className="!-bottom-1.5 !-right-1.5 !size-[18px] bg-black text-white ring-background [&>svg]:!size-[14px]">
          <MarkGithubIcon />
        </AvatarBadge>
      )}
    </Avatar>
  );
}

export function GitLabAvatar({ size = 32, username, src, title, showProviderBadge = true }: ProviderAvatarProps): JSX.Element {
  const handle = cleanUsername(username);
  return (
    <ProviderInitialAvatar
      size={size}
      title={title ?? handle ?? "GitLab"}
      src={src ?? (handle ? `https://gitlab.com/${handle}.png` : undefined)}
      fallback={initials(handle ?? "GL")}
      badge={showProviderBadge ? "GL" : null}
    />
  );
}

export function BitbucketAvatar({ size = 32, username, src, title, showProviderBadge = true }: ProviderAvatarProps): JSX.Element {
  const handle = cleanUsername(username);
  return (
    <ProviderInitialAvatar
      size={size}
      title={title ?? handle ?? "Bitbucket"}
      src={src ?? (handle ? `https://bitbucket.org/account/${handle}/avatar/${size * 2}/` : undefined)}
      fallback={initials(handle ?? "BB")}
      badge={showProviderBadge ? "BB" : null}
    />
  );
}

function ProviderInitialAvatar({
  size,
  title,
  src,
  fallback,
  badge
}: {
  size: number;
  title: string;
  src?: string;
  fallback: string;
  badge: string | null;
}) {
  return (
    <Avatar className="overflow-visible" title={title} style={{ width: size, height: size }}>
      <AvatarImage src={src} alt={title} className="rounded-full" />
      <AvatarFallback>{fallback}</AvatarFallback>
      {badge && <AvatarBadge className="bg-black text-[6px] font-semibold leading-none text-white ring-background">{badge}</AvatarBadge>}
    </Avatar>
  );
}

function cleanUsername(username: string | null | undefined): string | null {
  const value = username?.trim().replace(/^@/, "");
  return value || null;
}

function initials(value: string): string {
  return value.trim().replace(/^@/, "").slice(0, 2).toUpperCase() || "GH";
}
