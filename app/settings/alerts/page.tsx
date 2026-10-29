import { AlertForm } from "@/components/AlertForm";
import { BrandLogo } from "@/components/BrandLogo";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import "@/components/os/shell.css";
import {
  getAlertThresholds,
  getCampuses,
  getMetrics,
  getUserProfile,
} from "@/lib/metrics";

export default async function AlertsSettingsPage() {
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);

  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const [metrics, campuses, thresholds] = await Promise.all([
    getMetrics(supabase),
    getCampuses(supabase),
    getAlertThresholds(supabase),
  ]);

  return (
    <main className="welcome welcome-page">
      <div className="welcome-inner">
        <BrandLogo href={null} showSubtitle={false} />
        <h1>Alerts</h1>
        <p>
          Administrators can set rules that surface on the dashboard concerns
          panel.
        </p>
        <div className="welcome-stack">
          <AlertForm metrics={metrics} campuses={campuses} />
          <section className="welcome-card">
            <h2>Active thresholds</h2>
            {thresholds.length === 0 ? (
              <p>No thresholds configured yet.</p>
            ) : (
              <ul className="welcome-list">
                {thresholds.map((t) => (
                  <li key={t.id}>
                    <p className="welcome-item-title">
                      {t.label ?? t.metric?.label}
                    </p>
                    <p>
                      {t.campus?.name ?? "Church-wide"} · threshold{" "}
                      {t.drop_percent}% over {t.months_window} months
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <Link href="/settings" className="welcome-back">
          Back to admin settings
        </Link>
      </div>
    </main>
  );
}
