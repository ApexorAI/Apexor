"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

/** ENV */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Targets */
const TARGETS = { calls: 40, meetings: 1, skill_minutes: 240 };

/** Score weights (sum 100) */
const WEIGHTS = { calls: 33, meetings: 33, skill: 34 };

type DailyLog = {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
  calls: number;
  meetings: number;
  skill_minutes: number;
  notes: string | null;
  created_at: string;
};

/** Date helpers (safe) */
function toYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymdToDateLocal(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0); // noon avoids DST bugs
}
function addDays(ymd: string, delta: number) {
  const dt = ymdToDateLocal(ymd);
  dt.setDate(dt.getDate() + delta);
  return toYMD(dt);
}

/** Math helpers */
function clamp01(x: number) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
function clampPct(x: number) {
  return Math.max(0, Math.min(100, Number.isFinite(x) ? x : 0));
}
function pct(value: number, target: number) {
  if (target <= 0) return 0;
  return clampPct(Math.round((value / target) * 100));
}
function avg(nums: number[]) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

/** Business logic */
function hitCount(l: DailyLog) {
  let hits = 0;
  if (l.calls >= TARGETS.calls) hits++;
  if (l.meetings >= TARGETS.meetings) hits++;
  if (l.skill_minutes >= TARGETS.skill_minutes) hits++;
  return hits;
}
function isStreakDay(l: DailyLog) {
  return hitCount(l) >= 2; // your rule
}
function score(l: DailyLog) {
  const c = clamp01(l.calls / TARGETS.calls) * WEIGHTS.calls;
  const m = clamp01(l.meetings / TARGETS.meetings) * WEIGHTS.meetings;
  const s = clamp01(l.skill_minutes / TARGETS.skill_minutes) * WEIGHTS.skill;
  return Math.round(c + m + s);
}

/** Tiny “chart” */
function Sparkline({ values }: { values: number[] }) {
  const w = 140;
  const h = 36;
  if (!values.length) return <div style={{ opacity: 0.6 }}>No data</div>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="sparkline">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts.join(" ")} opacity="0.9" />
    </svg>
  );
}

/** Benchmarks calendar: last 14 days */
function CalendarGrid({ todayYMD, logs }: { todayYMD: string; logs: DailyLog[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, DailyLog>();
    for (const l of logs) m.set(l.log_date, l);
    return m;
  }, [logs]);

  const days = useMemo(() => {
    const out: string[] = [];
    const start = addDays(todayYMD, -13);
    let cursor = start;
    for (let i = 0; i < 14; i++) {
      out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }, [todayYMD]);

  return (
    <div style={styles.calWrap}>
      {days.map((d) => {
        const l = byDate.get(d) ?? null;
        const hits = l ? hitCount(l) : 0;
        const sc = l ? score(l) : 0;

        // color by hits
        let bg = "#fee2e2";
        let border = "#fecaca";
        if (hits === 1) {
          bg = "#fef3c7";
          border = "#fde68a";
        }
        if (hits >= 2) {
          bg = "#dcfce7";
          border = "#86efac";
        }

        return (
          <div key={d} style={{ ...styles.calDay, background: bg, borderColor: border }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>{d.slice(5)}</div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{sc}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>{hits}/3</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const todayYMD = useMemo(() => toYMD(new Date()), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [editingToday, setEditingToday] = useState(false);

  const todayLog = useMemo(() => logs.find((l) => l.log_date === todayYMD) ?? null, [logs, todayYMD]);

  // Auth boot
  useEffect(() => {
    async function boot() {
      setMsg("");
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.push("/login");
        return;
      }
      setUserId(data.user.id);
    }
    boot();
  }, [router]);

  // Fetch logs
  useEffect(() => {
    if (!userId) return;

    async function fetchLogs() {
      setLoading(true);
      const { data, error } = await supabase
        .from("daily_logs")
        .select("*")
        .eq("user_id", userId)
        .order("log_date", { ascending: false });

      if (error) {
        setMsg(`Load error: ${error.message}`);
        setLogs([]);
        setLoading(false);
        return;
      }

      setLogs((data as DailyLog[]) ?? []);
      setLoading(false);
    }

    fetchLogs();
  }, [userId]);

  async function refetch() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .order("log_date", { ascending: false });

    if (error) {
      setMsg(`Load error: ${error.message}`);
      setLogs([]);
      return;
    }
    setLogs((data as DailyLog[]) ?? []);
  }

  // Weekly windows
  const start7 = useMemo(() => addDays(todayYMD, -6), [todayYMD]);
  const prevStart7 = useMemo(() => addDays(start7, -7), [start7]);

  const last7 = useMemo(() => logs.filter((l) => l.log_date >= start7), [logs, start7]);
  const prev7 = useMemo(
    () => logs.filter((l) => l.log_date >= prevStart7 && l.log_date < start7),
    [logs, prevStart7, start7]
  );

  // Weekly totals + avg score
  const weekly = useMemo(() => {
    const totals = last7.reduce(
      (a, l) => {
        a.calls += l.calls;
        a.meetings += l.meetings;
        a.skill += l.skill_minutes;
        return a;
      },
      { calls: 0, meetings: 0, skill: 0 }
    );
    const avgScore = avg(last7.map(score));
    return { ...totals, avgScore, daysLogged: last7.length };
  }, [last7]);

  // Trend (avg score last7 vs prev7)
  const trend = useMemo(() => {
    const lastAvg = avg(last7.map(score));
    const prevAvg = avg(prev7.map(score));
    const delta = lastAvg - prevAvg;
    return { lastAvg, prevAvg, delta, dir: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
  }, [last7, prev7]);

  // Streak (2/3 targets) — safe loop
  const streak = useMemo(() => {
    if (!logs.length) return 0;

    const byDate = new Map<string, DailyLog>();
    for (const l of logs) byDate.set(l.log_date, l);

    const counts = (ymd: string) => {
      const l = byDate.get(ymd);
      return l ? isStreakDay(l) : false;
    };

    const yesterday = addDays(todayYMD, -1);

    let anchor: string | null = null;
    if (counts(todayYMD)) anchor = todayYMD;
    else if (counts(yesterday)) anchor = yesterday;
    else return 0;

    let count = 0;
    let cursor = anchor;

    for (let i = 0; i < 365; i++) {
      if (!counts(cursor)) break;
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }, [logs, todayYMD]);

  // Today stats
  const todayStats = useMemo(() => {
    if (!todayLog) return null;
    return {
      hits: hitCount(todayLog),
      score: score(todayLog),
      callsPct: pct(todayLog.calls, TARGETS.calls),
      meetingsPct: pct(todayLog.meetings, TARGETS.meetings),
      skillPct: pct(todayLog.skill_minutes, TARGETS.skill_minutes),
    };
  }, [todayLog]);

  // Sparkline values (last 14 days)
  const sparkValues = useMemo(() => {
    const start14 = addDays(todayYMD, -13);
    const slice = logs
      .filter((l) => l.log_date >= start14)
      .sort((a, b) => a.log_date.localeCompare(b.log_date));
    return slice.map(score);
  }, [logs, todayYMD]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.h1}>Apexor</h1>
            <p style={styles.sub}>Phase 2 – Performance Intelligence</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={styles.pill}>{todayYMD}</div>
            <div style={styles.streakPill}>🔥 Streak: {streak}</div>
          </div>
        </div>

        {msg ? <div style={styles.noteBox}>{msg}</div> : null}

        {/* Trend + chart */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Trend (avg score):{" "}
            <strong>
              {trend.dir === "up" ? "▲" : trend.dir === "down" ? "▼" : "■"} {trend.delta}
            </strong>{" "}
            (last {trend.lastAvg} vs prev {trend.prevAvg})
          </div>
          <div>
            <Sparkline values={sparkValues} />
          </div>
        </div>

        {/* Benchmarks calendar */}
        <h2 style={styles.h2}>Benchmarks (last 14 days)</h2>
        {loading ? <div>Loading…</div> : <CalendarGrid todayYMD={todayYMD} logs={logs} />}

        <h2 style={styles.h2}>Today</h2>

        {loading ? (
          <div>Loading…</div>
        ) : !userId ? (
          <div style={{ opacity: 0.7 }}>Checking login…</div>
        ) : todayLog && !editingToday ? (
          <>
            <div style={{ marginBottom: 10, opacity: 0.75 }}>
              Rule: streak day = hit <strong>2/3</strong> targets • Hits:{" "}
              <strong>{todayStats?.hits ?? 0}/3</strong> • Score:{" "}
              <strong>{todayStats?.score ?? 0}/100</strong>
            </div>

            <div style={styles.grid}>
              <TargetStat label="Calls" value={todayLog.calls} target={TARGETS.calls} percent={todayStats?.callsPct ?? 0} />
              <TargetStat
                label="Meetings"
                value={todayLog.meetings}
                target={TARGETS.meetings}
                percent={todayStats?.meetingsPct ?? 0}
              />
              <TargetStat
                label="Skill minutes"
                value={todayLog.skill_minutes}
                target={TARGETS.skill_minutes}
                percent={todayStats?.skillPct ?? 0}
              />
              <div style={styles.stat}>
                <div style={styles.statLabel}>Notes</div>
                <div style={styles.statValueText}>{todayLog.notes ?? "-"}</div>
              </div>
            </div>

            <button style={{ ...styles.button, marginTop: 12 }} onClick={() => setEditingToday(true)}>
              Edit
            </button>
          </>
        ) : (
          <TodayForm
            userId={userId!}
            todayYMD={todayYMD}
            defaultCalls={todayLog?.calls ?? 0}
            defaultMeetings={todayLog?.meetings ?? 0}
            defaultSkillMinutes={todayLog?.skill_minutes ?? 0}
            defaultNotes={todayLog?.notes ?? ""}
            onCancel={todayLog ? () => setEditingToday(false) : undefined}
            onSaved={async () => {
              setEditingToday(false);
              setMsg("Saved!");
              await refetch();
              setTimeout(() => setMsg(""), 1500);
            }}
            onError={(e) => setMsg(e)}
          />
        )}

        <h2 style={{ ...styles.h2, marginTop: 28 }}>Weekly analytics (last 7 days)</h2>

        {loading ? (
          <div>Loading…</div>
        ) : (
          <>
            <div style={{ opacity: 0.75, marginBottom: 10 }}>
              Days logged: <strong>{weekly.daysLogged}</strong> • Avg score: <strong>{weekly.avgScore}</strong>
            </div>

            <div style={styles.grid}>
              <TargetStat label="Calls" value={weekly.calls} target={TARGETS.calls * 7} percent={pct(weekly.calls, TARGETS.calls * 7)} />
              <TargetStat
                label="Meetings"
                value={weekly.meetings}
                target={TARGETS.meetings * 7}
                percent={pct(weekly.meetings, TARGETS.meetings * 7)}
              />
              <TargetStat
                label="Skill minutes"
                value={weekly.skill}
                target={TARGETS.skill_minutes * 7}
                percent={pct(weekly.skill, TARGETS.skill_minutes * 7)}
              />
              <div style={styles.stat}>
                <div style={styles.statLabel}>Weekly targets</div>
                <div style={styles.statValue}>7 days</div>
                <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
                  Calls {TARGETS.calls}/day • Meetings {TARGETS.meetings}/day • Skill {TARGETS.skill_minutes}/day
                </div>
              </div>
            </div>
          </>
        )}

        <h2 style={{ ...styles.h2, marginTop: 28 }}>Past logs</h2>

        {loading ? (
          <div>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No logs yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Calls</th>
                  <th style={styles.th}>Meetings</th>
                  <th style={styles.th}>Skill</th>
                  <th style={styles.th}>Score</th>
                  <th style={styles.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={styles.td}>{l.log_date}</td>
                    <td style={styles.td}>{l.calls}</td>
                    <td style={styles.td}>{l.meetings}</td>
                    <td style={styles.td}>{l.skill_minutes}</td>
                    <td style={styles.td}>{score(l)}</td>
                    <td style={styles.td}>{l.notes ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TargetStat({ label, value, target, percent }: { label: string; value: number; target: number; percent: number }) {
  const hit = value >= target;
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
        Target: {target} • {percent}%
      </div>
      <div style={styles.progressOuter}>
        <div style={{ ...styles.progressInner, width: `${percent}%`, background: hit ? "#16a34a" : "#ef4444" }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: hit ? "#16a34a" : "#ef4444" }}>
        {hit ? "HIT" : "MISS"}
      </div>
    </div>
  );
}

function TodayForm({
  userId,
  todayYMD,
  defaultCalls,
  defaultMeetings,
  defaultSkillMinutes,
  defaultNotes,
  onCancel,
  onSaved,
  onError,
}: {
  userId: string;
  todayYMD: string;
  defaultCalls: number;
  defaultMeetings: number;
  defaultSkillMinutes: number;
  defaultNotes: string;
  onCancel?: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [calls, setCalls] = useState(defaultCalls);
  const [meetings, setMeetings] = useState(defaultMeetings);
  const [skillMinutes, setSkillMinutes] = useState(defaultSkillMinutes);
  const [notes, setNotes] = useState(defaultNotes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCalls(defaultCalls);
    setMeetings(defaultMeetings);
    setSkillMinutes(defaultSkillMinutes);
    setNotes(defaultNotes ?? "");
  }, [defaultCalls, defaultMeetings, defaultSkillMinutes, defaultNotes]);

  async function save() {
    onError("");
    setSaving(true);

    const { error } = await supabase.from("daily_logs").upsert(
      [
        {
          user_id: userId,
          log_date: todayYMD,
          calls,
          meetings,
          skill_minutes: skillMinutes,
          notes: notes.trim() ? notes.trim() : null,
        },
      ],
      { onConflict: "user_id,log_date" }
    );

    setSaving(false);

    if (error) {
      onError(`Save error: ${error.message}`);
      return;
    }

    onSaved();
  }

  return (
    <div style={styles.form}>
      <div style={styles.formRow}>
        <label style={styles.label}>Calls</label>
        <input style={styles.input} type="number" value={calls} onChange={(e) => setCalls(Number(e.target.value))} />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Meetings</label>
        <input style={styles.input} type="number" value={meetings} onChange={(e) => setMeetings(Number(e.target.value))} />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Skill minutes</label>
        <input style={styles.input} type="number" value={skillMinutes} onChange={(e) => setSkillMinutes(Number(e.target.value))} />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Notes</label>
        <textarea style={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button style={styles.button} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save today"}
        </button>
        {onCancel ? (
          <button style={{ ...styles.button, background: "#e5e7eb", color: "#111827" }} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f6f7fb", padding: 32, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
  card: { maxWidth: 980, margin: "0 auto", background: "white", borderRadius: 14, padding: 24, boxShadow: "0 10px 30px rgba(0,0,0,0.06)" },
  headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 },
  h1: { margin: 0, fontSize: 32, letterSpacing: -0.5 },
  sub: { margin: "6px 0 0", opacity: 0.7 },
  pill: { padding: "8px 12px", background: "#111827", color: "white", borderRadius: 999, fontSize: 12 },
  streakPill: { padding: "6px 10px", background: "#f3f4f6", color: "#111827", borderRadius: 999, fontSize: 12, border: "1px solid #e5e7eb" },
  h2: { margin: "18px 0 10px", fontSize: 18 },
  grid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  stat: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fafafa" },
  statLabel: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 700 },
  statValueText: { fontSize: 14, lineHeight: 1.3 },
  progressOuter: { marginTop: 8, height: 10, width: "100%", background: "#e5e7eb", borderRadius: 999, overflow: "hidden" },
  progressInner: { height: "100%", borderRadius: 999 },

  calWrap: { marginTop: 10, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10 },
  calDay: { border: "1px solid", borderRadius: 12, padding: 10, minHeight: 72, display: "flex", flexDirection: "column", justifyContent: "space-between" },

  form: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fafafa", maxWidth: 520 },
  formRow: { display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, marginBottom: 10, alignItems: "center" },
  label: { fontSize: 13, opacity: 0.85 },
  input: { padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db", outline: "none" },
  textarea: { padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db", outline: "none", minHeight: 70, resize: "vertical" },
  button: { padding: "10px 14px", borderRadius: 10, border: "none", background: "#111827", color: "white", cursor: "pointer", fontWeight: 600 },

  tableWrap: { overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12, marginTop: 10 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: 12, fontSize: 12, background: "#f3f4f6", borderBottom: "1px solid #e5e7eb" },
  td: { padding: 12, borderBottom: "1px solid #f1f5f9", fontSize: 13 },

  noteBox: { padding: 12, borderRadius: 12, background: "#ecfeff", border: "1px solid #a5f3fc", marginBottom: 12 },
};