# Typing Rating

Everyone starts at 1000. Ranked rooms opt into rating changes; friendly rooms
and solo practice remain unrated. Each racer receives a pairwise Elo result
against every opponent. A finisher beats a non-finisher, finish order decides
between finishers, and non-finishers tie. Expected score uses the traditional
400-point logistic scale. K = 32, averaged across opponents. All expectations
use ratings before the race, and largest-remainder rounding keeps integer
changes exactly zero-sum. A race changes at most 32 points per player.

Ratings are applied only on normal completion or time limit, with at least
two racers and at least one finisher. Cancelled/abandoned races and any race
with fair-play flags produce no rating changes for anyone. Spectators never
enter scoring. Disconnecting does not remove a racer from the standings.
Results, ratings, and an immutable per-race change ledger commit in one SQLite
transaction. The ledger prevents duplicate updates, and survives room deletion.
Existing accounts start at 1000; old races are not retroactively rated.

The first 10 rated races are provisional. This is a visibility label, not a
different K factor. The leaderboard lists the top 50 established accounts.
Tiers: Bronze below 1000, Silver 1000, Gold 1200, Platinum 1400, Diamond 1600,
Master 1800. These are product labels, not calibrated WPM skill percentiles.

Private ranked rooms permit friend challenges, but repeated-opponent farming
and collusion remain possible. This is a first competitive rating system,
not a tournament-grade anti-cheat system. Public matchmaking and abuse review
would be necessary before attaching prizes or other stakes to it.
