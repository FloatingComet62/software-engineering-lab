"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signUpError } = await authClient.signIn.email({
      email,
      password,
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message ?? "Something went wrong");
      return;
    }

    router.push("/");
  };

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-zinc-900 px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-zinc-700 bg-zinc-800 p-8"
      >
        <h1 className="text-2xl font-semibold text-white">Login</h1>

        {error && (
          <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-white outline-none focus:border-zinc-400"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-white outline-none focus:border-zinc-400"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded bg-white px-3 py-2 font-medium text-zinc-900 disabled:opacity-50"
        >
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
