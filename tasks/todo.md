# Fix run — 2026-07-08
Source: tasks/audit_2026-07-08.md

## Critical
- [x] C1 in-app photo import contract (b: fn-inserts, client refreshes review banner) — index.html importWorkoutShot + fn dual-auth
- [x] C2 fail-open ingest auth — fn hard-fails when HACHI_INGEST_KEY missing; JWT path added
- [ ] C2b ROTATE HACHI_INGEST_KEY (dashboard) — replace hachi-test-123; update iOS Shortcut header — JASON
- [ ] C3 commit hyresult fn source — pull from dashboard → supabase/functions/hyresult/ → commit — JASON, blocks split-import fix

## High
- [x] H1 seedWeekSessions deleted (fn + call site)
- [x] H2 race-import benchmarks upsert onConflict + error check
- [x] H3 _localISO ×4 (HRV, log modal ×2, race import) — zero UTC slices remain
- [x] H4 fn dates JST-aware; year-normalize with future-clamp (was: force-current-year)
- [x] H5 uid resolution: JWT user → HACHI_DEFAULT_UID env → paginated listUsers fallback
- [ ] H5b optionally set HACHI_DEFAULT_UID secret (Jason's full UID) to skip listUsers on Shortcut path — JASON
- [x] H6 pushAll insert/upsert errors surfaced (one-time notice + console)

## Medium
- [x] M1 decision: direct selects stay; ARCHITECTURE.md corrected (RPC line) — commit updated doc
- [x] M2 featured race = latest-with-splits (date-sorted)
- [x] M3 "Best AG" → "Best rank"
- [x] M4 Anthropic fetch 30s AbortController
- [x] M5 profile insert failure surfaced
- [x] M6 README rewritten (repo)
- [ ] M7 commit tasks/ files (this dir) + fix project-instructions "RLS OFF" line → ON — JASON

## Low / Aesthetic
- [ ] L1 RACE_DATE + PROG content-out-of-code — DEFERRED to refactor step 2 (agreed path)
- [x] L2 _isPro: target_format takes precedence; division fallback only
- [x] L4 fn supabase-js pinned @2.108.1
