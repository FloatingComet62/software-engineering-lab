"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ApiErrorBody, api } from "@/lib/api";

type Profile = { name: string; email: string; bestScore: number };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ profile: Profile }>("/profile")
      .then(({ profile }) => setProfile(profile))
      .catch((err: ApiErrorBody) => setError(err.message));
  }, []);

  const total = HEATMAP.flatMap((week) => week.days).filter(
    (day) => day.level > 0,
  ).length;

  return (
    <div className="flex min-h-screen flex-1 flex-col items-center bg-zinc-900 px-4 py-12 font-mono text-white">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">
          ← Back
        </Link>

        {error && (
          <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <section className="grid gap-4 rounded-lg border border-zinc-700 bg-zinc-800 p-8 sm:grid-cols-3">
          <Field label="Name" value={profile?.name} />
          <Field label="Email" value={profile?.email} />
          <Field
            label="Best score"
            value={profile ? `${Math.round(profile.bestScore)} WPM` : undefined}
          />
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="truncate text-lg">{value ?? "—"}</span>
    </div>
  );
}
