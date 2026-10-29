import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CHMS_ENABLED, isChmsPath } from "@/lib/feature-flags";
import { isLocalPos } from "@/lib/pos/config";
import { safeNextPath } from "@/lib/safe-next";

export async function updateSession(request: NextRequest) {
  if (isLocalPos()) {
    if (request.nextUrl.pathname.startsWith("/login")) {
      return NextResponse.redirect(new URL("/pos", request.url));
    }
    return NextResponse.next({ request });
  }

  if (!CHMS_ENABLED && isChmsPath(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPage = request.nextUrl.pathname.startsWith("/login");
  const path = request.nextUrl.pathname;
  const isProtected =
    path === "/" ||
    path.startsWith("/dashboard") ||
    path.startsWith("/volunteer-matrix") ||
    path.startsWith("/monthly-expenses") ||
    path.startsWith("/pulse") ||
    (CHMS_ENABLED && path.startsWith("/chms")) ||
    path.startsWith("/settings") ||
    path.startsWith("/pos");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    const next = safeNextPath(path + request.nextUrl.search);
    url.pathname = "/login";
    url.search = "";
    if (next && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const destination = isLocalPos() ? "/pos" : next ?? "/";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return supabaseResponse;
}
