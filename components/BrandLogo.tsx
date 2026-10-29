import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  showSubtitle?: boolean;
  href?: string | null;
  size?: "sm" | "md";
  variant?: "default" | "light";
  stack?: boolean;
};

export function BrandLogo({
  showSubtitle = false,
  href = "/dashboard",
  size = "md",
  variant = "default",
  stack = false,
}: BrandLogoProps) {
  const iconSize = size === "sm" ? 32 : 40;
  const titleClass =
    variant === "light"
      ? stack
        ? "sfdc-logo-text pulse-wordmark"
        : "sfdc-logo-text truncate"
      : `navbar-logo-text font-bold tracking-tight truncate ${
          size === "sm" ? "text-sm" : "text-base"
        }`;
  const subtitleClass =
    variant === "light" ? "sfdc-logo-sub truncate" : "navbar-logo-sub text-xs truncate";

  const content = (
    <div className="flex items-center gap-3 min-w-0">
      <div className="shrink-0 rounded-md bg-white p-1 shadow-sm ring-1 ring-black/5">
        <Image
          src="/brand/cc-icon.png"
          alt=""
          width={iconSize}
          height={iconSize}
          className="rounded-sm"
          priority
        />
      </div>
      <div className="min-w-0 leading-tight">
        {stack ? (
          <p className={titleClass}>
            <span>Community</span>
            <span>Church</span>
          </p>
        ) : (
          <p className={titleClass}>Community Church</p>
        )}
        {showSubtitle && <p className={subtitleClass}>Ministry dashboard</p>}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={stack ? "pulse-brand hover:opacity-90 transition-opacity" : "hover:opacity-90 transition-opacity"}>
        {content}
      </Link>
    );
  }

  return content;
}
