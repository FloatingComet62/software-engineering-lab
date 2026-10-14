"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Rating = {
  rating: number;
  tier: string;
  races: number;
  wins: number;
  provisional: boolean;
  placementRemaining: number;
};
type Profile = Rating & { name: string; email: string; bestScore: number };
type Leader = Rating & { rank: number; userId: string; name: string };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api<{ profile: Profile }>("/profile"),
      api<{ players: Leader[] }>("/profile/leaderboard"),
    ])
      .then(([data, board]) => {
        setProfile(data.profile);
        setLeaders(board.players);
      })
      .catch((err: { message?: string }) =>
        setError(
          err.message ?? "Could not load your rating. Please try again.",
        ),
      );
  }, []);
  return (
    <div className="typing-app">
      <header className="site-header">
        <Link href="/" className="brand">
          i see i type<span className="brand-dot">.</span>
        </Link>
        <Link href="/multiplayer" className="mp-muted">
          multiplayer ↗
        </Link>
      </header>
      <main className="mp-room rating-profile">
        <div className="eyebrow">YOUR COMPETITIVE JOURNEY</div>
        <h1>{profile?.name ?? "Your profile"}</h1>
        {error && (
          <p className="mp-error" role="alert">
            {error} <Link href="/login">Sign in</Link>
          </p>
        )}
        {!profile && !error && <p className="intro">Loading your rating…</p>}
        {profile && (
          <>
            <section className="mp-panel rating-hero">
              <div>
                <span className="mp-overline">TYPING RATING</span>
                <div className="rating-number">{profile.rating}</div>
                <span className="rating-tier">
                  {profile.tier}
                  {profile.provisional ? " · provisional" : ""}
                </span>
              </div>
              <div className="rating-summary">
                <div>
                  <strong>{profile.races}</strong>
                  <span>ranked races</span>
                </div>
                <div>
                  <strong>{profile.wins}</strong>
                  <span>wins</span>
                </div>
              </div>
            </section>
            <p className="intro rating-help">
              {profile.provisional
                ? `${profile.placementRemaining} more ranked races to establish your rating and appear on the leaderboard.`
                : "Your rating reflects how you perform against other typists."}
            </p>
            <Link href="/multiplayer" className="mp-primary rating-cta">
              Play a ranked race →
            </Link>
          </>
        )}
        <section className="mp-panel rating-board">
          <span className="mp-overline">THE LEADERBOARD</span>
          <h2>Meet your next challenge.</h2>
          <p>
            Established typists with at least 10 rated races. Updated after
            every ranked race.
          </p>
          {leaders.length ? (
            <div className="mp-results-scroll">
              <table className="mp-results">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Typist</th>
                    <th>Rating</th>
                    <th>Tier</th>
                    <th>Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((leader) => (
                    <tr key={leader.userId}>
                      <td>#{leader.rank}</td>
                      <td>{leader.name}</td>
                      <td>{leader.rating}</td>
                      <td>{leader.tier}</td>
                      <td>{leader.wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="keyboard-hint">
              The starting line is open. Complete 10 rated races to earn your
              spot.
            </p>
          )}
        </section>
        <section className="rating-explainer">
          <h2>Skill, relative to the competition.</h2>
          <p>
            Everyone starts at 1000. Beat stronger opponents to earn more;
            losses against stronger typists cost less. Multiplayer races average
            your result against each opponent, with up to 32 points changing
            hands per race. Finishers beat non-finishers; non-finishers tie with
            each other.
          </p>
          <p>
            Friendly races and solo practice don’t affect your rating. Cancelled
            races, races without a finisher, and races with fair-play flags are
            unrated. Ratings measure competitive results, rather than a fixed
            words-per-minute target.
          </p>
          <p className="mp-muted">
            Bronze &lt;1000 · Silver 1000 · Gold 1200 · Platinum 1400 · Diamond
            1600 · Master 1800
          </p>
        </section>
      </main>
    </div>
  );
}
