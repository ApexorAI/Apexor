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

/** Input caps (integrity) */
const CAPS = { calls: 500, meetings: 20, skill_minutes: 600 };

/** Score weights (sum 100) */
const WEIGHTS = { calls: 33, meetings: 33, skill: 34 };

/** XP settings */
const XP_PER_SCORE = 10; // daily xp gain = score * 10

type DailyLog = {
  id: string;
  user_id: string;
  log_date: string;
  calls: number;
  meetings: number;
  skill_minutes: number;
  notes: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  total_xp: number;
  created_at: string;
  updated_at: string;
};

/** Date helpers */
function toYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymdToDateLocal(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
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
function clampInt(x: number, min: number, max: number) {
  const n = Number.isFinite(x) ? Math.floor(x) : min;
  return Math.max(min, Math.min(max, n));
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

/** Integrity: normalize inputs */
function normalizeInputs(raw: { calls: number; meetings: number; skill_minutes: number }) {
  return {
    calls: clampInt(raw.calls, 0, CAPS.calls),
    meetings: clampInt(raw.meetings, 0, CAPS.meetings),
    skill_minutes: clampInt(raw.skill_minutes, 0, CAPS.skill_minutes),
  };
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
  return hitCount(l) >= 2;
}
function score(l: DailyLog) {
  const c = clamp01(l.calls / TARGETS.calls) * WEIGHTS.calls;
  const m = clamp01(l.meetings / TARGETS.meetings) * WEIGHTS.meetings;
  const s = clamp01(l.skill_minutes / TARGETS.skill_minutes) * WEIGHTS.skill;
  return Math.round(c + m + s);
}
function xpFromScore(s: number) {
  return clampInt(s, 0, 100) * XP_PER_SCORE;
}

/** Leveling */
function levelFromXp(totalXp: number) {
  // Simple growth curve: level up every 500xp for early game, then slowly increases
  // thresholds: 0, 500, 1100, 1800, 2600, ...
  let level = 1;
  let need = 0;
  let step = 500;
  while (totalXp >= need + step) {
    need += step;
    level++;
    step = Math.round(step * 1.2); // 20% harder each level
    if (level > 1000) break;
  }
  const nextNeed = need + step;
  const into = totalXp - need;
  const pctToNext = Math.round((into / step) * 100);
  return { level, need, nextNeed, into, step, pctToNext: clampPct(pctToNext) };
}

/** Achievements */
type Achievement = {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  progressText: string;
};

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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts.join(" ")} opacity="0.9" />
    </svg>
  );
}

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
  const [profile, setProfile] = useState<Profile | null>(null);

  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [editingToday, setEditingToday] = useState(false);

  const todayLog = useMemo(() => logs.find((l) => l.log_date === todayYMD) ?? null, [logs, todayYMD]);

  // Auth boot + ensure profile exists
  useEffect(() => {
    async function boot() {
      setMsg("");
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.push("/login");
        return;
      }
      const uid = data.user.id;
      setUserId(uid);

      // Ensure profile row exists
      const { data: prof, error: pErr } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
      if (pErr) {
        setMsg(`Profile error: ${pErr.message}`);
        return;
      }
      if (!prof) {
        const { data: created, error: cErr } = await supabase
          .from("profiles")
          .insert([{ id: uid, total_xp: 0 }])
          .select("*")
          .single();
        if (cErr) {
          setMsg(`Profile create error: ${cErr.message}`);
          return;
        }
        setProfile(created as Profile);
      } else {
        setProfile(prof as Profile);
      }
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

  async function addXp(amount: number) {
    if (!profile) return;
    const newTotal = Number(profile.total_xp) + amount;
    const { data, error } = await supabase
      .from("profiles")
      .update({ total_xp: newTotal, updated_at: new Date().toISOString() })
      .eq("id", profile.id)
      .select("*")
      .single();

    if (error) {
      setMsg(`XP update error: ${error.message}`);
      return;
    }
    setProfile(data as Profile);
  }

  // Weekly windows
  const start7 = useMemo(() => addDays(todayYMD, -6), [todayYMD]);
  const prevStart7 = useMemo(() => addDays(start7, -7), [start7]);

  const last7 = useMemo(() => logs.filter((l) => l.log_date >= start7), [logs, start7]);
  const prev7 = useMemo(
    () => logs.filter((l) => l.log_date >= prevStart7 && l.log_date < start7),
    [logs, prevStart7, start7]
  );

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

  const trend = useMemo(() => {
    const lastAvg = avg(last7.map(score));
    const prevAvg = avg(prev7.map(score));
    const delta = lastAvg - prevAvg;
    return { lastAvg, prevAvg, delta, dir: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
  }, [last7, prev7]);

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

  const todayStats = useMemo(() => {
    if (!todayLog) return null;
    return {
      hits: hitCount(todayLog),
      score: score(todayLog),
      callsPct: pct(todayLog.calls, TARGETS.calls),
      meetingsPct: pct(todayLog.meetings, TARGETS.meetings),
      skillPct: pct(todayLog.skill_minutes, TARGETS.skill_minutes),
      xp: xpFromScore(score(todayLog)),
    };
  }, [todayLog]);

  const sparkValues = useMemo(() => {
    const start14 = addDays(todayYMD, -13);
    const slice = logs.filter((l) => l.log_date >= start14).sort((a, b) => a.log_date.localeCompare(b.log_date));
    return slice.map(score);
  }, [logs, todayYMD]);

  const levelInfo = useMemo(() => levelFromXp(profile?.total_xp ?? 0), [profile?.total_xp]);

  // Leaderboard (you-only for now)
  const bestThisWeek = useMemo(() => {
    if (!last7.length) return 0;
    return Math.max(...last7.map(score));
  }, [last7]);

  // Achievements (computed, not stored yet)
  const achievements: Achievement[] = useMemo(() => {
    const hasAnyLog = logs.length > 0;
    const threeDayStreak = streak >= 3;
    const sevenDayStreak = streak >= 7;

    const hit33 = todayLog ? hitCount(todayLog) === 3 : false;

    const logged7Days = last7.length >= 7;

    return [
      {
        id: "first-log",
        title: "First Log",
        desc: "Create your first daily log.",
        done: hasAnyLog,
        progressText: hasAnyLog ? "Done" : "0/1",
      },
      {
        id: "hit-3of3",
        title: "Perfect Day",
        desc: "Hit 3/3 targets in a day.",
        done: !!hit33,
        progressText: hit33 ? "Done" : "Not yet",
      },
      {
        id: "streak-3",
        title: "Streak x3",
        desc: "Get a 3-day streak (2/3 targets).",
        done: threeDayStreak,
        progressText: `${Math.min(streak, 3)}/3`,
      },
      {
        id: "streak-7",
        title: "Streak x7",
        desc: "Get a 7-day streak (2/3 targets).",
        done: sevenDayStreak,
        progressText: `${Math.min(streak, 7)}/7`,
      },
      {
        id: "week-complete",
        title: "Full Week Logged",
        desc: "Log 7 days in the last 7-day window.",
        done: logged7Days,
        progressText: `${Math.min(last7.length, 7)}/7`,
      },
    ];
  }, [logs, last7.length, streak, todayLog]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.h1}>Apexor</h1>
            <p style={styles.sub}>Phase 3 – Gamification (Bundle v1)</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={styles.pill}>{todayYMD}</div>
            <div style={styles.streakPill}>🔥 Streak: {streak}</div>
          </div>
        </div>

        {msg ? <div style={styles.noteBox}>{msg}</div> : null}

        {/* Level block */}
        <div style={styles.levelRow}>
          <div style={styles.levelBox}>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Level</div>
            <div style={{ fontSize: 26, fontWeight: 900 }}>{levelInfo.level}</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Total XP: {profile?.total_xp ?? 0}</div>
          </div>
          <div style={styles.levelBox}>
            <div style={{ opacity: 0.75, fontSize: 12 }}>To next level</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {levelInfo.into}/{levelInfo.step} ({levelInfo.pctToNext}%)
            </div>
            <div style={styles.progressOuter}>
              <div style={{ ...styles.progressInner, width: `${levelInfo.pctToNext}%`, background: "#111827" }} />
            </div>
          </div>
          <div style={styles.levelBox}>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Weekly best</div>
            <div style={{ fontSize: 26, fontWeight: 900 }}>{bestThisWeek}</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Best daily score (last 7)</div>
          </div>
        </div>

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
              Rule: streak day = hit <strong>2/3</strong> targets • Hits: <strong>{todayStats?.hits ?? 0}/3</strong> • Score:{" "}
              <strong>{todayStats?.score ?? 0}/100</strong> • XP today: <strong>+{todayStats?.xp ?? 0}</strong>
            </div>

            <div style={styles.grid}>
              <TargetStat label="Calls" value={todayLog.calls} target={TARGETS.calls} percent={todayStats?.callsPct ?? 0} />
              <TargetStat label="Meetings" value={todayLog.meetings} target={TARGETS.meetings} percent={todayStats?.meetingsPct ?? 0} />
              <TargetStat label="Skill minutes" value={todayLog.skill_minutes} target={TARGETS.skill_minutes} percent={todayStats?.skillPct ?? 0} />
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
            onSaved={async (xpGained) => {
              setEditingToday(false);
              setMsg(`Saved! XP +${xpGained}`);
              await refetch();
              await addXp(xpGained);
              setTimeout(() => setMsg(""), 1800);
            }}
            onError={(e) => setMsg(e)}
          />
        )}

        <h2 style={{ ...styles.h2, marginTop: 28 }}>Achievements</h2>
        <div style={styles.achWrap}>
          {achievements.map((a) => (
            <div key={a.id} style={{ ...styles.achCard, borderColor: a.done ? "#86efac" : "#e5e7eb" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>{a.title}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{a.progressText}</div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{a.desc}</div>
              <div style={{ marginTop: 10, fontWeight: 800, color: a.done ? "#16a34a" : "#6b7280" }}>
                {a.done ? "UNLOCKED" : "LOCKED"}
              </div>
            </div>
          ))}
        </div>

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
              <TargetStat label="Meetings" value={weekly.meetings} target={TARGETS.meetings * 7} percent={pct(weekly.meetings, TARGETS.meetings * 7)} />
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
                  <th style={styles.th}>XP</th>
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
                    <td style={styles.td}>{xpFromScore(score(l))}</td>
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
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: hit ? "#16a34a" : "#ef4444" }}>
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
  onSaved: (xpGained: number) => void;
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

    const normalized = normalizeInputs({
      calls,
      meetings,
      skill_minutes: skillMinutes,
    });

    const tempLog: DailyLog = {
      id: "temp",
      user_id: userId,
      log_date: todayYMD,
      calls: normalized.calls,
      meetings: normalized.meetings,
      skill_minutes: normalized.skill_minutes,
      notes: notes.trim() ? notes.trim() : null,
      created_at: new Date().toISOString(),
    };

    const xpGained = xpFromScore(score(tempLog));

    const { error } = await supabase.from("daily_logs").upsert(
      [
        {
          user_id: userId,
          log_date: todayYMD,
          calls: normalized.calls,
          meetings: normalized.meetings,
          skill_minutes: normalized.skill_minutes,
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

    onSaved(xpGained);
  }

  return (
    <div style={styles.form}>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
        Caps: Calls ≤ {CAPS.calls}, Meetings ≤ {CAPS.meetings}, Skill ≤ {CAPS.skill_minutes}
      </div>

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
        <input
          style={styles.input}
          type="number"
          value={skillMinutes}
          onChange={(e) => setSkillMinutes(Number(e.target.value))}
        />
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

  levelRow: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  levelBox: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fafafa" },

  grid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  stat: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fafafa" },
  statLabel: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 700 },
  statValueText: { fontSize: 14, lineHeight: 1.3 },
  progressOuter: { marginTop: 8, height: 10, width: "100%", background: "#e5e7eb", borderRadius: 999, overflow: "hidden" },
  progressInner: { height: "100%", borderRadius: 999 },

  calWrap: { marginTop: 10, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10 },
  calDay: { border: "1px solid", borderRadius: 12, padding: 10, minHeight: 72, display: "flex", flexDirection: "column", justifyContent: "space-between" },

  achWrap: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  achCard: { border: "2px solid", borderRadius: 14, padding: 12, background: "white" },

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