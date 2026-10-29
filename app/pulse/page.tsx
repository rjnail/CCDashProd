import "@/components/os/shell.css";
import { PulseShell } from "@/components/os/PulseShell";
import { loadPulsePage } from "@/lib/os/load";
import { getUserProfile } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type PulsePageProps = {
  searchParams: Promise<{ team?: string; view?: string; q?: string; campus?: string | string[] }>;
};

export default async function PulsePage({ searchParams }: PulsePageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) redirect("/login?next=/pulse");

  const data = await loadPulsePage(supabase, profile, params.team, params.campus);
  return <PulseShell data={data} initialView={params.view} initialQuestion={params.q ?? ""} />;
}
