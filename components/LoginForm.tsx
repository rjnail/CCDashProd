"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const LOGIN_INPUT_CLASS =
  "input input-bordered w-full min-h-11 border-2 shadow-sm";

export function LoginForm({ nextPath }: { nextPath?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (isSignUp) {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: email.split("@")[0] },
        },
      });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setMessage(
          "Account created. Check your email to confirm, then sign in."
        );
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
      } else {
        router.push(nextPath || "/");
        router.refresh();
      }
    }

    setLoading(false);
  }

  return (
    <div className="card w-full max-w-md bg-base-100 shadow-xl border border-base-300">
      <div className="card-body">
        <h1 className="text-2xl text-[var(--cc-timber)]">Sign in</h1>
        <p className="text-sm text-base-content/70">
          Staff access to the ministry dashboard
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <label className="form-control w-full">
            <span className="label-text">Email</span>
            <input
              type="email"
              className={LOGIN_INPUT_CLASS}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text">Password</span>
            <input
              type="password"
              className={LOGIN_INPUT_CLASS}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          {error && (
            <div className="alert alert-error text-sm py-2">{error}</div>
          )}
          {message && (
            <div className="alert alert-info text-sm py-2">{message}</div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={loading}
          >
            {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          className="btn btn-link btn-sm mt-2"
          onClick={() => setIsSignUp(!isSignUp)}
        >
          {isSignUp
            ? "Already have an account? Sign in"
            : "Need an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
