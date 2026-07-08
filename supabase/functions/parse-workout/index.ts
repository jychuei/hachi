import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hachi-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";
const DEFAULT_EMAIL = "jychuei@gmail.com";

const EXTRACT_PROMPT = `You are parsing 1-3 screenshots of a SINGLE workout from a running watch app (COROS/Garmin).
The images may include: an overview (distance, total time, avg pace, avg HR, calories, date/time, primary benefit, perceived effort) and one or more lap tables (lap, time, distance, pace).
They are ONE session split across images and may be in any order. Merge them.

Return ONLY strict JSON, no markdown, no prose:
{
  "date": "YYYY-MM-DD",            // from the overview timestamp; null if absent
  "type": "Run",                   // one of: Run, Gym, F45, Compromised, Race Sim, Other. Default Run for a watch run.
  "distance_km": 0.0,              // total
  "duration_min": 0,               // total time rounded to nearest minute
  "avg_hr": 0,                     // null if absent
  "avg_pace": "m:ss",              // per km, null if absent
  "calories": 0,                   // null if absent
  "primary_benefit": "",           // e.g. "Threshold (High Aerobic)", null if absent
  "effort_10": 0,                  // perceived effort x/10, null if absent
  "title": "",                     // workout title/name if shown, e.g. "Track Sprints", "Easy Run", null if absent
  "surge_summary": ""              // one line describing lap pacing shape, e.g. "warmup 5:25, surge block laps 4-9 (4:27-5:10), final push 4:49"
}
If a field is unreadable use null. Never invent values.`;

function strip(t: string) {
  return t.replace(/```json/g, "").replace(/```/g, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const ingestKey = Deno.env.get("HACHI_INGEST_KEY");
  if (!ingestKey) return json({ error: "server misconfigured: HACHI_INGEST_KEY not set" }, 500);
  const keyOk = req.headers.get("x-hachi-key") === ingestKey;
  let jwtUserId: string | null = null;
  if (!keyOk) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: ud, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !ud?.user) return json({ error: "unauthorized" }, 401);
    jwtUserId = ud.user.id;
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  let images: string[];
  if (typeof body.images === "string") images = body.images.split(/\s+/).filter(Boolean);
  else if (Array.isArray(body.images)) images = body.images.flat(Infinity).filter((x: unknown) => typeof x === "string" && x.length > 0);
  else images = [];
  const email: string = body.user_email || DEFAULT_EMAIL;
  const source: string = body.source || "shortcut";
  if (!images.length) return json({ error: "no images" }, 400);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

  const content: any[] = images.map((b64) => {
    const m = b64.match(/^data:(image\/\w+);base64,/);
    const data = b64.replace(/^data:image\/\w+;base64,/, "");
    let media_type = m ? m[1] : "image/jpeg";
    if (!m) {
      if (data.startsWith("iVBORw0KGgo")) media_type = "image/png";
      else if (data.startsWith("R0lGOD")) media_type = "image/gif";
      else if (data.startsWith("UklGR")) media_type = "image/webp";
      else if (data.startsWith("/9j/")) media_type = "image/jpeg";
    }
    return { type: "image", source: { type: "base64", media_type, data } };
  });
  content.push({ type: "text", text: EXTRACT_PROMPT });

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 30_000);
  let aiRes: Response;
  try {
    aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content }] }),
      signal: ac.signal,
    });
  } catch (e) {
    const err = e as Error;
    return json({ error: err.name === "AbortError" ? "anthropic timeout (30s)" : "anthropic fetch failed: " + err.message }, 504);
  } finally { clearTimeout(tid); }
  if (!aiRes.ok) return json({ error: "anthropic " + aiRes.status, detail: await aiRes.text() }, 502);

  const aiData = await aiRes.json();
  const raw = (aiData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let p: any;
  try { p = JSON.parse(strip(raw)); } catch { return json({ error: "parse failed", raw }, 422); }

  {
    // JST (UTC+9, no DST): avoid the UTC 'yesterday before 09:00' trap
    const todayJST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const m = String(p.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) p.date = todayJST;
    else {
      // watch screenshots omit the year; normalize to current JST year,
      // roll back one year only if that lands in the future
      const cy = +todayJST.slice(0, 4);
      let d = `${cy}-${m[2]}-${m[3]}`;
      if (d > todayJST) d = `${cy - 1}-${m[2]}-${m[3]}`;
      p.date = d;
    }
  }
  p.duration_min = Math.round(Number(p.duration_min) || 0);
  p.distance_km = Number(p.distance_km) || null;
  {
    const TYPES = ["Run", "Gym", "F45", "Compromised", "Race Sim", "Other"];
    const t = String(p.type || "Run").toLowerCase();
    p.type = TYPES.find((x) => x.toLowerCase() === t) || "Run";
  }
  p.run_type = null;
  if (p.type === "Run") {
    const hay = `${p.title || ""} ${p.primary_benefit || ""}`.toLowerCase();
    if (/sprint|interval|track|vo2|anaerobic|speed|repeat|fartlek/.test(hay)) p.run_type = "Intervals";
    else if (/threshold|tempo|lactate/.test(hay)) p.run_type = "Threshold";
    else if (/hill/.test(hay)) p.run_type = "Hill sprints";
    else if (/long/.test(hay)) p.run_type = "Long run";
    else if (/recovery|easy/.test(hay)) p.run_type = "Easy";
    else if (/base|low aerobic|aerobic/.test(hay)) p.run_type = "Z2";
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let userId = jwtUserId;
  if (!userId) userId = Deno.env.get("HACHI_DEFAULT_UID") || null;
  if (!userId) {
    const { data: au } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = au?.users?.find((u: any) => u.email === email)?.id ?? null;
  }
  if (!userId) return json({ error: "user not found: " + email }, 404);

  let dupQ = sb.from("sessions").select("id")
    .eq("user_id", userId).eq("date", p.date).eq("type", p.type).eq("duration_min", p.duration_min);
  dupQ = p.distance_km == null ? dupQ.is("distance_km", null) : dupQ.eq("distance_km", p.distance_km);
  const { data: dup } = await dupQ.maybeSingle();
  if (dup) return json({ ok: true, deduped: true, session_id: dup.id, summary: summarize(p) });

  const notesParts = [
    p.primary_benefit && `Benefit: ${p.primary_benefit}`,
    p.calories && `${p.calories}cal`,
    p.surge_summary,
  ].filter(Boolean);

  const { data: ins, error: iErr } = await sb.from("sessions").insert({
    user_id: userId,
    date: p.date,
    type: p.type,
    run_type: p.run_type,
    duration_min: p.duration_min,
    distance_km: p.distance_km,
    hr: p.avg_hr ?? null,
    pace_sec: paceSec(p.avg_pace),
    rpe: p.effort_10 ?? null,
    notes: notesParts.join(". "),
    source,
    needs_review: true,
  }).select("id").single();
  if (iErr) return json({ error: "insert failed", detail: iErr.message }, 500);

  return json({ ok: true, session_id: ins.id, summary: summarize(p) });
});

function summarize(p: any) {
  return `${p.type} ${p.distance_km ?? "?"}km / ${p.duration_min}min` +
    (p.avg_pace ? ` @ ${p.avg_pace}/km` : "") + (p.avg_hr ? ` HR${p.avg_hr}` : "") + ` (${p.date})`;
}

function paceSec(p?: string) {
  if (!p) return null;
  const m = String(p).match(/^(\d+):(\d{2})$/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
}
