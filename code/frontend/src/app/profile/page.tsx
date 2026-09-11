"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ApiErrorBody, api } from "@/lib/api";

type Profile = { name: string; email: string; bestScore: number };

const WEEKS = 53;
const LEVEL_COLORS = [
  "bg-zinc-900",
  "bg-emerald-900",
  "bg-emerald-700",
  "bg-emerald-500",
  "bg-emerald-300",
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// ponytail: hardcoded placeholder activity; swap for race_result counts per day when wired.
const HEATMAP = Array.from({ length: WEEKS }, (_, w) => ({
  id: `w${w}`,
  month: w % 4.4 < 1 ? MONTHS[Math.floor(w / 4.4)] : "",
  days: Array.from({ length: 7 }, (_, d) => {
    const n = Math.imul(w * 7 + d + 1, 2654435761);
    const noise = ((n ^ (n >>> 13)) >>> 0) % 100;
    const busySeason = w > 30 && w < 48 ? 25 : 0;
    const score = noise + busySeason;
    const level =
      score < 45 ? 0 : score < 65 ? 1 : score < 80 ? 2 : score < 92 ? 3 : 4;
    return { id: `w${w}d${d}`, level };
  }),
}));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

        <section className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-800 p-8">
          <h2 className="text-sm text-zinc-300">
            {total} active days in the last year
          </h2>
          <div className="overflow-x-auto">
            <div className="inline-flex flex-col gap-1">
              <div className="flex gap-[3px] pl-8 text-[10px] text-zinc-500">
                {HEATMAP.map((week) => (
                  <span key={week.id} className="w-[11px]">
                    {week.month}
                  </span>
                ))}
              </div>
              <div className="flex gap-[3px]">
                <div className="flex w-7 flex-col gap-[3px] text-[10px] text-zinc-500">
                  {DAYS.map((day, i) => (
                    <span key={day} className="h-[11px] leading-[11px]">
                      {i % 2 ? day : ""}
                    </span>
                  ))}
                </div>
                {HEATMAP.map((week) => (
                  <div key={week.id} className="flex flex-col gap-[3px]">
                    {week.days.map((day) => (
                      <div
                        key={day.id}
                        title={`${day.level} race${day.level === 1 ? "" : "s"}`}
                        className={`h-[11px] w-[11px] rounded-sm ${LEVEL_COLORS[day.level]}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1 text-[10px] text-zinc-500">
            Less
            {LEVEL_COLORS.map((color) => (
              <div
                key={color}
                className={`h-[11px] w-[11px] rounded-sm ${color}`}
              />
            ))}
            More
          </div>
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
