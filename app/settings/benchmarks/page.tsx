import { BenchmarkForm } from "@/components/BenchmarkForm";
import { BenchmarkList } from "@/components/BenchmarkList";
import { BrandLogo } from "@/components/BrandLogo";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import "@/components/os/shell.css";
import {
  getBenchmarkTargets,
  getCampuses,
  getMetrics,
  getUserProfile,
} from "@/lib/metrics";
import { canEditBenchmarks } from "@/lib/permissions";
import { TARGET_FISCAL_YEAR } from "@/lib/types";

export default async function BenchmarksSettingsPage() {
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);

  if (!profile) redirect("/login");
  if (!canEditBenchmarks(profile)) redirect("/dashboard");

  const [metrics, campuses, benchmarks] = await Promise.all([
    getMetrics(supabase),
    getCampuses(supabase),
    getBenchmarkTargets(supabase, TARGET_FISCAL_YEAR),
  ]);

  return (
    <main className="welcome welcome-page">
      <div className="welcome-inner">
        <BrandLogo href={null} showSubtitle={false} />
        <h1>Benchmarks</h1>
        <p>
          Set comparison points for dashboard metrics. Stoplights: green =
          at/above benchmark, yellow = within 10%, red = more than 10% below.
        </p>
        <div className="welcome-stack">
          <BenchmarkForm metrics={metrics} campuses={campuses} />
          <section className="welcome-card">
            <h2>Active benchmarks ({TARGET_FISCAL_YEAR})</h2>
            <BenchmarkList
              benchmarks={benchmarks}
              metrics={metrics}
              campuses={campuses}
            />
          </section>
        </div>
        <Link href="/settings" className="welcome-back">
          Back to admin settings
        </Link>
      </div>
    </main>
  );
}
