# Task: Fix "maiden value in /profile is not displaying in bowling stats"

## Root Cause
The `/profile` page (StatBlock.jsx) already renders `b.maidens || 0` correctly.
The data was lost in the turf-wide fallback aggregation `aggregateTurfStats`
(controllers/turf.controller.js), which runs on `endTurf`. It accumulated
`bowlingInnings, wickets, ballsBowled, runsConceded` but did NOT accumulate or
write `maidens` — unlike the per-innings path `aggregateTeamStats` which does
`bw.maidens += row.maidens`.

## Status: DONE
- [x] Add `maidens: 0` to the accumulator object in `getAcc()`.
- [x] Accumulate `a.maidens += row.maidens || 0;` in the bowling loop.
- [x] Write `bw.maidens += a.maidens || 0;` when folding into the player.

## Note
This fixes future turf endings. Existing player records that already completed
a turf before this fix won't be retroactively corrected unless their turf
aggregates are re-run (they are overwritten the next time that player's turf
is ended, or by re-running the aggregation against saved match data).

---

# Task: Fix "images not rendering in /tcl page (404 for /images/placeholder-player.svg)"

## Root Cause
The placeholder image file was missing from disk. `public/images/` existed but
was empty, while the EJS templates (e.g. `views/tcl/session.ejs`) and React
components reference `/images/placeholder-player.svg`. The server's static
middleware serves it from `public/images/placeholder-player.svg`, which did not
exist → 404.

## Status: DONE
- [x] Created `public/images/placeholder-player.svg` (a cricket-person silhouette glyph) so the placeholder now resolves under `/images/placeholder-player.svg`.

# Task: Fix "profile picture on scorecard not in place + scorecard not responsive"

## Root Cause
`td.col-player` had `display: flex` applied directly to a `<td>`, which breaks
table-cell semantics and pushed the profile picture out of alignment with the
player name/status. The responsive scorecard rules also used buggy
`nth-child` targeting that misaligned the stat columns on narrow screens.

## Status: DONE
- [x] Removed `display: flex` from `td.col-player`/`th.col-player`; kept it as a
      normal table cell (left-aligned, vertically centered).
- [x] Added a `.scorecard-player-cell` flex wrapper and wrapped the pic + info in
      it inside `scorecard-innings.ejs` (batting + bowling) and `live.ejs`
      (Players roster, both team columns).
- [x] Rewrote the mobile scorecard rules to give the player-name column flexible
      space (`max-width: 46%`) and keep numeric stat columns compact, so the
      table fits narrow screens without cascading misalignment.
- [x] Shrunk the avatar to 26px and font sizes to 11px on mobile, and kept the
      `.scorecard-table-wrap { overflow-x: auto }` as the final safety net.

# Task: Make .live-summary-footer and .live-score-team responsive

## Status: DONE
- [x] `.live-score-row` on mobile now uses a 5-column grid
      (`1fr auto auto auto 1fr`) so both team badges + names, both score
      blocks, and the VS divider stay centered and don't overflow.
- [x] `.live-score-team` centers its badge + name, truncates long team names
      with ellipsis, and lets the badge image scale with `object-fit: cover`.
- [x] `.live-summary-footer` on mobile uses a 3-column grid (Target / Extras /
      Total) with each item centered and stacked (label above value), so the
      footer stays arranged on narrow screens.
- [x] Kept `.live-summary-footer` and `.live-score-row` as flex rows on larger
      screens (unchanged desktop layout).

# Task: Make .confirm-overlay / .confirm-overlay-visible responsive

## Root Cause
`.confirm-overlay` used `inset: 0` + `align-items: center` with no padding or
scroll, and `.confirm-modal` was capped at `max-width: 320px` with no
`max-height`/scroll. On small or short screens, tall modal content could get
clipped at top/bottom and the buttons could overflow.

## Status: DONE
- [x] On mobile (≤480px), `.confirm-overlay` now aligns to the top, adds safe
      padding, and scrolls (`overflow-y: auto`) instead of clipping.
- [x] `.confirm-modal` fills the available width, is capped at `90vh`, scrolls
      internally if taller than the viewport, and uses `margin: auto 0` so it
      stays comfortably centered.
- [x] `.confirm-actions` wraps and its buttons go full-width centered, so the
      confirm/cancel buttons stack cleanly on narrow screens.
- [x] Desktop layout unchanged (overlay centers, modal stays at 320px).

# Task: Make the whole /points page responsive

## Root Cause
`/points` reuses `.scorecard-table.points-table`, but `points.css` desktop rules
(`min-width: 660px` inherited from the generic table, plus `min-width: 180px` on
the team column and `min-width: 48px` on every numeric column) had higher
specificity than the generic `.scorecard-table` mobile rules in
`live-scoring.css`. So on mobile the table kept its wide desktop width and
overflowed the viewport, making the page non-responsive.

## Status: DONE
- [x] On mobile (≤480px), `.scorecard-table.points-table` now uses
      `table-layout: fixed` + `min-width: 0; width: 100%` so it shrinks to fit
      the container instead of overflowing.
- [x] Position column (#) set to a compact 32px.
- [x] Team column gets the flexible space (`width: auto; min-width: 0`) and long
      team names truncate with ellipsis.
- [x] Numeric stat columns (P/W/L/T/NR/Pts/NRR) set to compact fixed widths
      (34px) with tightened padding so the whole row fits narrow screens.
- [x] Team avatar shrinks to 28px (and 24px on ≤360px), fonts reduced to 12px
      (11px on very small phones).
- [x] Desktop table layout unchanged (kept the original wider columns).

# Task: Fix "MVP points (.mvp-total) not displaying on /tcl/session/:id"

## Root Cause
The TCL session page's cross-match MVP leaderboard is rendered by
`public/js/turf-stats.js`, which computes each player's MVP points via
`window.CricketMVP.computeMVP(match)`. However, `window.CricketMVP` is only
exposed by `public/js/mvp.js`, which was loaded on the live match page
(`views/turfs/live.ejs`) but NOT on the TCL session page
(`views/tcl/session.ejs`). So the guard `if (window.CricketMVP)` in
`turf-stats.js` was false, `p.mvpPts` stayed 0, and the `.mvp-total` cells in
the MVP leaderboard showed 0/no points.

## Status: DONE
- [x] Added `<script src="/js/mvp.js"></script>` to `views/tcl/session.ejs`,
      loaded BEFORE `turf-stats.js`, so `window.CricketMVP` exists when the
      MVP tab is clicked and the leaderboard shows real points.

# Task: Fix "over-ball-chip shows only 5 balls instead of 6"

## Root Cause
`.live-over-balls` (the in-play "This over" ball chip row) had
`max-height: 64px; overflow-y: auto`. When a full 6-ball over wraps onto a
second row on narrower screens, the second row overflowed the 64px cap and got
clipped (or required scrolling), so only 5 of the 6 chips were visible even
though `currentOverBalls` held all 6.

## Status: DONE
- [x] Removed the `max-height: 64px` cap and the `overflow-y: auto` on
      `.live-over-balls` in `public/css/style.css` (set `max-height: none;
      overflow-y: visible`). Every ball chip — including all 6 legal balls of
      an over, which may wrap onto multiple rows — now stays fully visible.
- [x] Also removed stale calls to the undefined `maybeStartNewOver(team)` in
      `controllers/turf.controller.js` (would throw a ReferenceError on legal
      deliveries and abort ball recording before the ball was appended to
      `currentOverBalls`).

# Task: Make .players-page container responsive in /points

## Root Cause
The `/points` page reuses the shared `.players-page` container (max-width 900px,
padding 20px). On tablets/phones the page still used the full desktop padding
and the container didn't constrain to the viewport, so the page could overflow
horizontally (the "players-page unresponsive" symptom).

## Status: DONE
- [x] On ≤768px, `.players-page` now sets `max-width: 100%`, reduces padding to
      `10px 12px 40px`, and adds `overflow-x: hidden` so the container never
      exceeds the viewport.
- [x] `.points-table-wrap` on ≤768px is capped to `width/max-width: 100%` and
      keeps `overflow-x: auto` + `-webkit-overflow-scrolling: touch` so any
      oversized content scrolls inside the wrapper instead of blowing out the
      page.
- [x] Combined with the earlier ≤480px table-column compaction, the whole
      points table now fits narrow screens while the container stays pinned to
      the viewport.

# Task: Reset all player stats (manual test baseline)

## Status: DONE
- [x] Added `scripts/reset-all-player-stats.js` (one-off maintenance script).
- [x] Ran it — connected to `mongodb://127.0.0.1:27017/cricket` and reset
      `turfStats` + `tclStats` (batting/bowling) to 0, and cleared
      `matchMvpCount` + `turfMvpCount`, on **47 player(s)** (all modified).
- [x] This gives a clean baseline so `/players/:id/profile` stat storage can be
      re-verified from zero.

# Task: Fix player stats not saving to /players/:id/profile after matches

## Root Cause
`aggregateTeamStats` routed each match's stats into a SINGLE stat block:
TCL matches (`tournamentId` set) went only to `tclStats`, and turf matches
went only to `turfStats`. The product rule is that `turfStats` is the OVERALL
record (turf + TCL combined), while `tclStats` is TCL-only. So TCL match
performances never appeared in the "Turf" tab on the profile page, and the
user saw stats as "not saving."

Also, `endMatch` only aggregated innings that had already finished; ending a
half-played match (e.g. 2 of 4 overs) did not fold the current in-progress
innings into profiles, and no "No Result" was recorded.

## Status: DONE
- [x] `aggregateTeamStats` now writes EVERY innings to `turfStats` (overall),
      and additionally to `tclStats` when the match is a TCL fixture.
- [x] Extracted the per-block fold into `applyTeamStats(match, team, statsKey)`
      so the same innings can be applied to both `turfStats` and `tclStats`.
- [x] `endMatch` now:
      - folds any finished-but-unaggregated innings (`aggregatePendingInningsStats`),
      - forces aggregation of BOTH teams (so the current in-progress innings
        stats are saved even if the match is abandoned early),
      - declares the match "completed" with `result = "No Result"` and no
        `winnerKey` when it was ended before a result was decided.
- [x] Per-innings saving already worked: `recordBall`/`endInnings` call
      `aggregatePendingInningsStats` so every completed innings folds into
      profiles immediately.
- [x] Added `player.markModified(statsKey)` inside `applyTeamStats` so the
      deep `statsKey` > batting/bowling subdocuments are always persisted
      (Mongoose sometimes misses in-place changes on nested sub-subdocs).
- [x] Verified TCL matches (`match.tournamentId` set) are recorded through the
      same `recordBall` flow and fold into BOTH `turfStats` (overall) and
      `tclStats` (TCL-only). TCL batting + bowling now show up under the
      "Turf" tab too. MVP counts (`matchMvpCount`) already increment for any
      route that completes a match, so TCL MVPs are included in the overall
      record.
