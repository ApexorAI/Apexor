"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

/**
 * REQUIRED: .env.local
 * NEXT_PUBLIC_SUPABASE_URL=...
 * NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Phase 2: targets (hardcoded for now)
const TARGETS = {
  calls: 40,
  meetings: 1,
  skill_minutes: 240,
};

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

function toYMD(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Safer local date parsing (noon avoids DST weirdness)
function ymdToDateLocal(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function addDays(ymd: string, delta: number) {
  const dt = ymdToDateLocal(ymd);
  dt.setDate(dt.getDate() + delta);
  return toYMD(dt);
}

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function pct(value: number, target: number) {
  if (target <= 0) return 0;
  return clampPct(Math.round((value / target) * 100));
}

function hitCountForDay(l: DailyLog) {
  let hits = 0;
  if (l.calls >= TARGETS.calls) hits++;
  if (l.meetings >= TARGETS.meetings) hits++;
  if (l.skill_minutes >= TARGETS.skill_minutes) hits++;
  return hits;
}

export default function Home() {
  const router = useRouter();

  const todayYMD = useMemo(() => toYMD(new Date()), []);
  const [userId, setUserId] = useState<string | null>(null);

  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  const [editingToday, setEditingToday] = useState(false);

  const todayLog = useMemo(
    () => logs.find((l) => l.log_date === todayYMD) ?? null,
    [logs, todayYMD]
  );

  // Weekly summary (last 7 days incl today)
  const weekSummary = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6); // today + 6 previous = 7 days
    const startYMD = toYMD(start);

    const last7 = logs.filter((l) => l.log_date >= startYMD);

    const totals = last7.reduce(
      (acc, l) => {
        acc.calls += l.calls;
        acc.meetings += l.meetings;
        acc.skill += l.skill_minutes;
        return acc;
      },
      { calls: 0, meetings: 0, skill: 0 }
    );

    return {
      daysLogged: last7.length,
      calls: totals.calls,
      meetings: totals.meetings,
      skill: totals.skill,
      startYMD,
    };
  }, [logs]);

  // ✅ Streak: counts if HIT >= 2 out of 3 targets
  const streak = useMemo(() => {
    if (!logs.length) return { current: 0, lastCountedDay: null as string | null };

    const byDate = new Map<string, number>();
    for (const l of logs) byDate.set(l.log_date, hitCountForDay(l));

    const countsAsStreakDay = (ymd: string) => (byDate.get(ymd) ?? 0) >= 2;

    const yesterday = addDays(todayYMD, -1);

    let anchor: string | null = null;
    if (countsAsStreakDay(todayYMD)) anchor = todayYMD;
    else if (countsAsStreakDay(yesterday)) anchor = yesterday;
    else return { current: 0, lastCountedDay: null };

    let count = 0;
    let cursor = anchor;

    // Hard safety limit: 365 days
    for (let i = 0; i < 365; i++) {
      if (!countsAsStreakDay(cursor)) break;
      count++;
      cursor = addDays(cursor, -1); // ALWAYS move back one day
    }

    return { current: count, lastCountedDay: anchor };
  }, [logs, todayYMD]);

  // 1) Check auth on load
  useEffect(() => {
    async function boot() {
      setMsg("");

      if (!supabaseUrl || !supabaseAnonKey) {
        setMsg(
          "Missing env vars. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY then restart."
        );
        setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getUser();

      if (!data.user) {
        router.push("/login");
        return;
      }

      setUserId(data.user.id);
    }

    boot();
  }, [router]);

  // 2) Fetch logs once we have userId
  useEffect(() => {
    if (!userId) return;

    async function fetchLogs() {
      setMsg("");
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

  const todayTargets = useMemo(() => {
    if (!todayLog) return null;

    const callsPct = pct(todayLog.calls, TARGETS.calls);
    const meetingsPct = pct(todayLog.meetings, TARGETS.meetings);
    const skillPct = pct(todayLog.skill_minutes, TARGETS.skill_minutes);

    return {
      callsPct,
      meetingsPct,
      skillPct,
      callsHit: todayLog.calls >= TARGETS.calls,
      meetingsHit: todayLog.meetings >= TARGETS.meetings,
      skillHit: todayLog.skill_minutes >= TARGETS.skill_minutes,
      hits: hitCountForDay(todayLog),
    };
  }, [todayLog]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.h1}>Apexor</h1>
            <p style={styles.sub}>Daily performance log</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={styles.pill}>{todayYMD}</div>
            <div style={styles.streakPill}>
              🔥 Streak:{" "}
              {streak.current > 0 ? `${streak.current} day${streak.current === 1 ? "" : "s"}` : "0"}
            </div>
          </div>
        </div>

        {msg ? <div style={styles.noteBox}>{msg}</div> : null}

        <h2 style={styles.h2}>Today</h2>

        {loading ? (
          <div>Loading…</div>
        ) : !userId ? (
          <div style={{ opacity: 0.7 }}>Checking login…</div>
        ) : todayLog && !editingToday ? (
          <>
            <div style={{ marginBottom: 10, opacity: 0.75 }}>
              Streak day rule: hit <strong>2 out of 3</strong> targets (calls / meetings / skill)
              {todayTargets ? (
                <>
                  {" "}
                  • Today hits: <strong>{todayTargets.hits}/3</strong>
                </>
              ) : null}
            </div>

            <div style={styles.grid}>
              <TargetStat
                label="Calls"
                value={todayLog.calls}
                target={TARGETS.calls}
                percent={todayTargets?.callsPct ?? 0}
                hit={todayTargets?.callsHit ?? false}
              />
              <TargetStat
                label="Meetings"
                value={todayLog.meetings}
                target={TARGETS.meetings}
                percent={todayTargets?.meetingsPct ?? 0}
                hit={todayTargets?.meetingsHit ?? false}
              />
              <TargetStat
                label="Skill minutes"
                value={todayLog.skill_minutes}
                target={TARGETS.skill_minutes}
                percent={todayTargets?.skillPct ?? 0}
                hit={todayTargets?.skillHit ?? false}
              />
              <div style={styles.stat}>
                <div style={styles.statLabel}>Notes</div>
                <div style={styles.statValueText}>{todayLog.notes ?? "-"}</div>
              </div>
            </div>

            <button
              style={{ ...styles.button, marginTop: 12 }}
              onClick={() => setEditingToday(true)}
            >
              Edit
            </button>
          </>
        ) : (
          <TodayForm
            userId={userId}
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

        <h2 style={{ ...styles.h2, marginTop: 28 }}>Weekly summary (last 7 days)</h2>

        {loading ? (
          <div>Loading…</div>
        ) : (
          <>
            <div style={{ opacity: 0.7, marginBottom: 10 }}>
              From {weekSummary.startYMD} to {todayYMD}
            </div>

            <div style={styles.grid}>
              <div style={styles.stat}>
                <div style={styles.statLabel}>Days logged</div>
                <div style={styles.statValue}>{weekSummary.daysLogged}</div>
                <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
                  Target: 7
                </div>
              </div>

              <TargetStat
                label="Calls"
                value={weekSummary.calls}
                target={TARGETS.calls * 7}
                percent={pct(weekSummary.calls, TARGETS.calls * 7)}
                hit={weekSummary.calls >= TARGETS.calls * 7}
              />
              <TargetStat
                label="Meetings"
                value={weekSummary.meetings}
                target={TARGETS.meetings * 7}
                percent={pct(weekSummary.meetings, TARGETS.meetings * 7)}
                hit={weekSummary.meetings >= TARGETS.meetings * 7}
              />
              <TargetStat
                label="Skill minutes"
                value={weekSummary.skill}
                target={TARGETS.skill_minutes * 7}
                percent={pct(weekSummary.skill, TARGETS.skill_minutes * 7)}
                hit={weekSummary.skill >= TARGETS.skill_minutes * 7}
              />
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

function TargetStat({
  label,
  value,
  target,
  percent,
  hit,
}: {
  label: string;
  value: number;
  target: number;
  percent: number;
  hit: boolean;
}) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>

      <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
        Target: {target} • {percent}%
      </div>

      <div style={styles.progressOuter}>
        <div
          style={{
            ...styles.progressInner,
            width: `${percent}%`,
            background: hit ? "#16a34a" : "#ef4444",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          fontWeight: 700,
          color: hit ? "#16a34a" : "#ef4444",
        }}
      >
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
        <input
          style={styles.input}
          type="number"
          value={calls}
          onChange={(e) => setCalls(Number(e.target.value))}
        />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Meetings</label>
        <input
          style={styles.input}
          type="number"
          value={meetings}
          onChange={(e) => setMeetings(Number(e.target.value))}
        />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Skill minutes</label>
        <input
          style={styles.input}
          type="number"
          value={skillMinutes}
          onChange={(e) => setSkillMinutes(Number(e.target.value))}
        />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Notes</label>
        <textarea
          style={styles.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button style={styles.button} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save today"}
        </button>

        {onCancel ? (
          <button
            style={{ ...styles.button, background: "#e5e7eb", color: "#111827" }}
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f6f7fb",
    padding: 32,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  },
  card: {
    maxWidth: 980,
    margin: "0 auto",
    background: "white",
    borderRadius: 14,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  h1: { margin: 0, fontSize: 32, letterSpacing: -0.5 },
  sub: { margin: "6px 0 0", opacity: 0.7 },
  pill: {
    padding: "8px 12px",
    background: "#111827",
    color: "white",
    borderRadius: 999,
    fontSize: 12,
  },
  streakPill: {
    padding: "6px 10px",
    background: "#f3f4f6",
    color: "#111827",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid #e5e7eb",
  },
  h2: { margin: "18px 0 10px", fontSize: 18 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
  },
  stat: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 12,
    background: "#fafafa",
  },
  statLabel: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 700 },
  statValueText: { fontSize: 14, lineHeight: 1.3 },
  progressOuter: {
    marginTop: 8,
    height: 10,
    width: "100%",
    background: "#e5e7eb",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressInner: {
    height: "100%",
    borderRadius: 999,
  },
  form: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "#fafafa",
    maxWidth: 520,
  },
  formRow: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: 10,
    marginBottom: 10,
    alignItems: "center",
  },
  label: { fontSize: 13, opacity: 0.85 },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    outline: "none",
  },
  textarea: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    outline: "none",
    minHeight: 70,
    resize: "vertical",
  },
  button: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: 12,
    fontSize: 12,
    background: "#f3f4f6",
    borderBottom: "1px solid #e5e7eb",
  },
  td: {
    padding: 12,
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
  },
  noteBox: {
    padding: 12,
    borderRadius: 12,
    background: "#ecfeff",
    border: "1px solid #a5f3fc",
    marginBottom: 12,
  },
};