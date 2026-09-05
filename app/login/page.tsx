"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
      callbackUrl: "/dashboard",
    });

    if (result?.error) {
      setError("Invalid email or password.");
      setIsLoading(false);
      return;
    }

    window.location.assign(result?.url ?? "/dashboard");
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-ink">Sign in</h1>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-ink">
            Email
            <input className="mt-1 w-full rounded border border-border bg-bg px-3 py-2" name="email" type="email" required />
          </label>
          <label className="block text-sm text-ink">
            Password
            <input className="mt-1 w-full rounded border border-border bg-bg px-3 py-2" name="password" type="password" required />
          </label>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button className="w-full rounded bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={isLoading} type="submit">
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
