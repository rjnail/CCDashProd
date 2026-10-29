"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  canViewMonthlyExpenses,
  canViewVolunteerMatrix,
  isAdmin,
} from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";
import { BrandLogo } from "./BrandLogo";
import { CHMS_ENABLED } from "@/lib/feature-flags";

const BASE_APP_LINKS = [
  { href: "/dashboard", label: "Dashboard", match: "/dashboard" },
] as const;

const VOLUNTEER_MATRIX_LINKS = [
  {
    href: "/volunteer-matrix",
    label: "Volunteer Matrix",
    match: "/volunteer-matrix",
  },
] as const;

const FINANCIAL_APP_LINKS = [
  {
    href: "/monthly-expenses",
    label: "Monthly Expenses",
    match: "/monthly-expenses",
  },
] as const;

type NavbarProps = {
  profile: UserProfile | null;
};

export function Navbar({ profile }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const appLinks = [
    ...BASE_APP_LINKS,
    ...(profile && canViewVolunteerMatrix(profile)
      ? VOLUNTEER_MATRIX_LINKS
      : []),
    ...(profile && canViewMonthlyExpenses(profile) ? FINANCIAL_APP_LINKS : []),
    ...(CHMS_ENABLED
      ? [{ href: "/chms", label: "ChMS", match: "/chms" } as const]
      : []),
  ];

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="sfdc-global-header">
        <div className="sfdc-global-header__inner">
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
            <BrandLogo showSubtitle={false} href={undefined} variant="light" />
          </Link>
          <div className="sfdc-global-search hidden md:block">
            <input
              type="search"
              placeholder="Search dashboards, reports, and more…"
              aria-label="Global search"
              disabled
            />
          </div>
          <div className="sfdc-global-actions">
            <Link href="/" className="sfdc-global-link">
              Home
            </Link>
            {profile && isAdmin(profile) && (
              <Link href="/settings/feedback" className="sfdc-global-link">
                Feedback
              </Link>
            )}
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="sfdc-global-user">
                {profile?.display_name ?? "Staff"}
              </div>
              <ul
                tabIndex={0}
                className="menu dropdown-content z-50 mt-2 w-52 rounded border border-base-300 bg-base-100 p-2 shadow-lg text-base-content"
              >
                <li className="menu-title text-xs">
                  {profile?.role === "admin" ? "Administrator" : "Staff"}
                </li>
                <li>
                  <button type="button" onClick={signOut}>
                    Sign out
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <nav className="sfdc-app-nav" aria-label="Application">
        <div className="sfdc-app-nav__inner">
          {appLinks.map((link) => {
            const active =
              pathname === link.href ||
              pathname.startsWith(`${link.match}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`sfdc-app-nav__link${
                  active ? " sfdc-app-nav__link--active" : ""
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
