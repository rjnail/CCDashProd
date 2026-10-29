const ALLOWED_PREFIXES = [
  "/dashboard",
  "/volunteer-matrix",
  "/monthly-expenses",
  "/settings",
  "/pulse",
  "/pos",
] as const;

/** Internal path to return to after login. Rejects external and unknown routes. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw, "http://local.invalid");
  } catch {
    return null;
  }

  const path = url.pathname;
  const allowed =
    path === "/" ||
    ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (!allowed) return null;
  return `${path}${url.search}`;
}
