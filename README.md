# HACHI 八

HYROX training tracker PWA for the HYROX Bras (Jason, Tim, Gerry, Yosuke).
Live: https://hachi-flame.vercel.app

- Single-file PWA: `index.html` (vanilla JS + Chart.js), Vercel auto-deploy on push to main
- Backend: Supabase (Postgres + Auth + Edge Functions), RLS ON all tables
- Screenshot ingest: iOS Shortcut or in-app upload → `supabase/functions/parse-workout` (Anthropic vision) → review banner
- Race import: hyresult.com URL → `hyresult` Edge fn (source: see tasks/todo.md C3)

Docs: `ARCHITECTURE.md` (system map) · `tasks/lessons.md` (failure rules) · `tasks/todo.md` (open work) · `tasks/audit_2026-07-08.md` (latest audit)

Deploy: `hd` alias (commit+push). Edge fn: `supabase functions deploy parse-workout --no-verify-jwt` — commit immediately after.
