import { BrandLogo } from "@/components/BrandLogo";
import { getUserProfile } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import "@/components/os/shell.css";

const LINKS = [
  {
    href: "/settings/users",
    label: "Users",
    detail: "Staff accounts, dashboard access, and Pulse meeting membership.",
  },
  {
    href: "/settings/benchmarks",
    label: "Benchmarks",
    detail: "Comparison points used on the ministry dashboard.",
  },
  {
    href: "/settings/alerts",
    label: "Alerts",
    detail: "Thresholds that surface on the dashboard concerns panel.",
  },
] as const;

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) redirect("/login?next=/settings");
  if (profile.role !== "admin") redirect("/");

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <BrandLogo href={null} showSubtitle={false} />
        <h1>Admin Settings</h1>
        <p>Users, benchmarks, and alerts stay available here.</p>
        <div className="welcome-settings">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
              <span>{link.detail}</span>
            </Link>
          ))}
        </div>
        <Link href="/" className="welcome-back">
          Back to welcome
        </Link>
      </div>
    </main>
  );
}
