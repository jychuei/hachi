# HACHI — Lessons
Last reviewed: 2026-07-08 (committed to repo per audit M7; prior authoritative copy lived in project knowledge)

## Deploy discipline
- Never transfer files via clipboard/`pbpaste`; never `rm ~/Downloads/index*` after downloading. Flow: download → `cp "$(ls -t ~/Downloads/<pattern> | head -1)" <dest>` → grep a token UNIQUE to the new version → deploy.
- Before editing an Edge Function, diff the repo copy against the DEPLOYED version (or origin/main). Deploying from a stale base silently reverts prior fixes. Commit immediately after every fn deploy so repo = deployed.
- Programme/content must be date-gated in code (activeProg date ranges), never deployment-gated.
- Verify grep counts by counting in the source first; `grep -c` counts LINES, not occurrences.
- Jason's zsh: `#` inline comments and `→` arrows in pasted commands become args — give commands bare. History expansion eats `!` in double quotes; curl/JSON one line. Long base64 pastes truncate (~1KB) — chunk or upload files instead.
- Supabase CLI loses creds per shell → `supabase login` each terminal; Edge secrets via dashboard only.
- Patch scripts: anchor on a single unique line, assert `count==1`, abort loud; idempotency guard.
- TS/Deno call-sites (Edge fns) do NOT import the Python model_registry — model strings live per-runtime, bumped by hand, kept in sync manually.

## Supabase / RLS / JS patterns
- **RLS IS ON (all tables, per-user).** own_write / own_update / own_or_peer_select. Anon key cannot INSERT/UPDATE (42501). Writes need authenticated session OR service-role. Logging path = app or Shortcut→Edge fn; curl+service-role is backfill ONLY. Verify via pg_policies — never trust prose.
- Peer/group reads: code uses DIRECT selects under own_or_peer_select policies (get_group_export RPC is unused by the app — audit M1 decision 2026-07-08).
- parse-workout auth (2026-07-08): x-hachi-key (Shortcut) OR user JWT (in-app). Fn hard-fails if HACHI_INGEST_KEY env missing. In-app inserts as the JWT user, not DEFAULT_EMAIL.
- Bulk insert PGRST102: identical key sets per row, or single-object POSTs (`hlog`).
- supabase-js builders are lazy thenables — un-awaited queries never execute.
- Every multi-user surface scoped per user at creation (`.eq('user_id',UID)`, per-UID localStorage key).
- Upserts carry every mutating column + explicit onConflict targets (bit twice: pushAll ✓, race-import benchmarks fixed 2026-07-08).
- Anthropic API 400s if declared media_type ≠ bytes — detect from base64 magic prefix.
- Ingest dedupe needs distance_km in the key. curl inserts have NO dedupe.
- One Garmin activity per Shortcut share. Blank Shortcut notification = fn error object.
- iOS standalone PWA: password auth only (magic link/redirect = daily logout). Reset passwords via admin API/dashboard, not recover-email.
- Pin ALL CDN imports incl. esm.sh in Edge fns (unpinned @2 float regressed once; pinned 2.108.1 everywhere 2026-07-08).

## Timezone (JST / UTC+9)
- `toISOString().slice(0,10)` = UTC date = "yesterday" before 09:00 JST. Use `_localISO()` for ALL date-gating and date-defaults — client AND Edge fn (fn violated this until 2026-07-08; now JST-computed).
- Watch screenshots omit the year: normalize to current JST year, roll back one year only if the result is in the future. Never force past years forward (corrupted Dec→future dates until 2026-07-08).

## Shell / environment
- `$SR` persists via gitignored `~/.hachi_env` (chmod 600) sourced from `~/.zshrc`.
- Never commit service-role key anywhere. Publishable key is public by design.
- macOS BSD base64: `-i` for file input; `-w0` doesn't exist (that's GNU).

## CSS
- Flex rows overflow when a child has flex-shrink:0 or lacks min-width:0. Long text cells need `min-width:0` + `overflow-wrap:anywhere`.

## Coaching-context corrections
- Compromised sessions are gym-only; outdoor preference applies to clean runs only.
- Treadmill at Warriors is fine (Jun 2026 correction — old "no treadmill at Warriors" rule is dead).
- Chest/pressing is antagonist/posture balance, NOT sled/WB carryover.
- Never infer age from a division band; Jason is 45.
- Sonnet-4-6→5 class model bumps on the vision fn change parse output shape — always diff a known screenshot before/after.
