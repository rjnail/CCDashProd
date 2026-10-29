import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/metrics";
import { isLocalPos } from "@/lib/pos/config";
import { createClient } from "@/lib/supabase/server";
import "@/components/os/shell.css";

export default async function HomePage() {
  if (isLocalPos()) redirect("/pos");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const profile = await getUserProfile(supabase);

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <BrandLogo href={null} showSubtitle={false} />
        <h1>Welcome to Community Church OS</h1>
        <p>Choose an area. Both use the staff account you just signed in with.</p>
        <div className="welcome-choices">
          <Link href="/dashboard" className="welcome-choice">
            Ministry Dashboard
            <small>Vital signs, the volunteer matrix, and monthly expenses.</small>
          </Link>
          <Link href="/pulse" className="welcome-choice welcome-choice-teal">
            Pulse Meeting
            <small>Executive, Pastoral, and Leadership team workspaces.</small>
          </Link>
        </div>
        {profile?.role === "admin" && (
          <Link href="/settings" className="welcome-admin">
            Admin Settings
          </Link>
        )}
      </div>
    </main>
  );
}
