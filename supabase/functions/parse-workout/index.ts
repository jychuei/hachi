import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  if (ingestKey && req.headers.get("x-hachi-key") !== ingestKey) {
    return json({ error: "unauthorized" }, 401);
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

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content }] }),
  });
  if (!aiRes.ok) return json({ error: "anthropic " + aiRes.status, detail: await aiRes.text() }, 502);

  const aiData = await aiRes.json();
  const raw = (aiData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let p: any;
  try { p = JSON.parse(strip(raw)); } catch { return json({ error: "parse failed", raw }, 422); }

  {
    const cy = new Date().getFullYear();
    if (!p.date) p.date = new Date().toISOString().slice(0, 10);
    else {
      const m = String(p.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m && +m[1] < cy) p.date = `${cy}-${m[2]}-${m[3]}`;
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

  const { data: au } = await sb.auth.admin.listUsers();
  const userId = au?.users?.find((u: any) => u.email === email)?.id;
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
