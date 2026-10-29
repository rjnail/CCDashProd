import { LoginForm } from "@/components/LoginForm";
import { BrandLogo } from "@/components/BrandLogo";
import { safeNextPath } from "@/lib/safe-next";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="login-brand-panel flex flex-col justify-center gap-6 p-8 lg:p-12">
        <BrandLogo showSubtitle href={null} size="md" />
        <div className="max-w-md space-y-3">
          <p className="login-brand-headline text-xl leading-snug">
            Ministry dashboard in one place.
          </p>
          <p className="login-brand-copy text-sm">
            Track vital signs, stewardship, weekend reach, and volunteer
            staffing across campuses.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center p-6 bg-base-200">
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
