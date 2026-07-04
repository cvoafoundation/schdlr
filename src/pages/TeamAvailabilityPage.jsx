import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../hooks/useAuth";
import { Panel, Field, LoadingBlock, ErrorBlock } from "../components/ui.jsx";
import { addDays, isWeekend, toDateInput, toDateOnly, isMemberBlockedOnDate, buildAvailabilityIndex } from "../lib/scheduling.js";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function fmtDateShort(d) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

export default function TeamAvailabilityPage() {
  const { profile } = useAuth();
  const [members, setMembers] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [recurringOff, setRecurringOff] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [partialBlocks, setPartialBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewingAs, setViewingAs] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [vacStart, setVacStart] = useState(""); const [vacEnd, setVacEnd] = useState(""); const [vacLabel, setVacLabel] = useState("");
  const [partRecurring, setPartRecurring] = useState(true); const [partDate, setPartDate] = useState("");
  const [partStart, setPartStart] = useState("12:00"); const [partEnd, setPartEnd] = useState("13:00"); const [partLabel, setPartLabel] = useState("Lunch");

  async function loadAll() {
    setLoading(true); setError("");
    const [m, bd, ro, va, pb] = await Promise.all([
      supabase.from("team_members").select("*").order("name"),
      supabase.from("blocked_dates").select("*"),
      supabase.from("recurring_days_off").select("*"),
      supabase.from("vacations").select("*"),
      supabase.from("partial_blocks").select("*"),
    ]);
    if (m.error) setError(m.error.message);
    setMembers(m.data || []);
    setBlockedDates(bd.data || []);
    setRecurringOff(ro.data || []);
    setVacations(va.data || []);
    setPartialBlocks(pb.data || []);
    if (!viewingAs && profile) setViewingAs(profile.id);
    setLoading(false);
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [profile]);

  const index = useMemo(
    () => buildAvailabilityIndex({
      blockedDates: blockedDates.map((r) => ({ ...r, blocked_date: r.blocked_date })),
      recurringOff, vacations, partialBlocks,
    }),
    [blockedDates, recurringOff, vacations, partialBlocks]
  );

  const isSelf = viewingAs === profile?.id;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const viewingMember = members.find((m) => m.id === viewingAs);

  const monthGrid = useMemo(() => {
    const { year, month } = viewMonth;
    const firstDow = new Date(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
    return cells;
  }, [viewMonth]);
  const next14 = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), []);

  async function toggleBlock(date) {
    if (!isSelf) return;
    const dstr = toDateInput(date);
    const existing = blockedDates.find((r) => r.member_id === viewingAs && r.blocked_date === dstr);
    if (existing) await supabase.from("blocked_dates").delete().eq("id", existing.id);
    else await supabase.from("blocked_dates").insert({ member_id: viewingAs, blocked_date: dstr });
    await supabase.from("audit_log").insert({ actor_id: viewingAs, action: `${existing ? "cleared" : "marked"} ${fmtDateShort(date)} ${existing ? "as available" : "unavailable"}` });
    loadAll();
  }
  async function toggleRecurring(dow) {
    if (!isSelf) return;
    const existing = recurringOff.find((r) => r.member_id === viewingAs && r.weekday === dow);
    if (existing) await supabase.from("recurring_days_off").delete().eq("id", existing.id);
    else await supabase.from("recurring_days_off").insert({ member_id: viewingAs, weekday: dow });
    await supabase.from("audit_log").insert({ actor_id: viewingAs, action: `${existing ? "removed" : "set"} recurring day off: ${WEEKDAY_LABELS[dow]}` });
    loadAll();
  }
  async function submitVacation() {
    if (!isSelf || !vacStart) return;
    const start = vacStart, end = vacEnd || vacStart;
    await supabase.from("vacations").insert({ member_id: viewingAs, start_date: start, end_date: end, label: vacLabel || "Time off" });
    await supabase.from("audit_log").insert({ actor_id: viewingAs, action: `added time off "${vacLabel || "Time off"}" (${start} – ${end})` });
    setVacStart(""); setVacEnd(""); setVacLabel(""); loadAll();
  }
  async function removeVacation(id) {
    if (!isSelf) return;
    await supabase.from("vacations").delete().eq("id", id);
    await supabase.from("audit_log").insert({ actor_id: viewingAs, action: "removed a time-off range" });
    loadAll();
  }
  async function submitPartialBlock() {
    if (!isSelf) return;
    const [sh, sm] = partStart.split(":").map(Number);
    const [eh, em] = partEnd.split(":").map(Number);
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    if (endMin <= startMin) return;
    if (!partRecurring && !partDate) return;
    await supabase.from("partial_blocks").insert({
      member_id: viewingAs, recurring: partRecurring, block_date: partRecurring ? null : partDate,
      start_minutes: startMin, end_minutes: endMin, label: partLabel || "Time off",
    });
    await supabase.from("audit_log").insert({ actor_id: viewingAs, action: `added "${partLabel || "Time off"}" break` });
    setPartLabel("Lunch"); loadAll();
  }
  async function removePartialBlock(id) {
    if (!isSelf) return;
    await supabase.from("partial_blocks").delete().eq("id", id);
    await supabase.from("audit_log").insert({ actor_id: viewingAs, action: "removed a daily break" });
    loadAll();
  }

  if (loading) return <LoadingBlock label="Loading availability…" />;
  if (!viewingMember) return <ErrorBlock message="Couldn't load your team profile. Check that your team_members row exists (Supabase Table Editor)." />;

  const myVacations = vacations.filter((v) => v.member_id === viewingAs);
  const myPartials = partialBlocks.filter((p) => p.member_id === viewingAs);

  return (
    <div>
      {error && <ErrorBlock message={error} />}
      <div className="cv-graphite font-mono text-[11px] tracking-widest mb-4 uppercase">Viewing calendar for</div>
      <div className="flex flex-wrap gap-2 mb-8">
        {members.map((m) => (
          <button key={m.id} onClick={() => setViewingAs(m.id)} className={`cv-pill flex items-center gap-2 px-3 py-2 ${viewingAs === m.id ? "cv-pill-active" : ""}`}>
            <span className="cv-pill-badge font-mono text-[10px] w-6 h-6 flex items-center justify-center border">{m.initials}</span>
            <span className="text-sm font-semibold">{m.name}</span>
          </button>
        ))}
      </div>
      {!isSelf && (
        <div className="cv-note font-mono text-[11px] mb-6 px-4 py-3">
          Read-only — you can see {viewingMember.name}'s availability, but only they can change it. That's enforced by
          the database (Row Level Security), not just hidden buttons.
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_320px] gap-8">
        <Panel className="cv-card">
          <div className="font-display font-bold text-lg">{viewingMember.name}'s calendar</div>
          <div className="cv-graphite font-mono text-[11px] mb-4">{isSelf ? "Click a weekday to mark it out. Click again to clear it." : "Read-only view."}</div>
          <div className="flex items-center justify-between my-4">
            <button onClick={() => setViewMonth((v) => { const m = v.month === 0 ? 11 : v.month - 1; const y = v.month === 0 ? v.year - 1 : v.year; return { year: y, month: m }; })} className="cv-icon-btn p-1">‹</button>
            <div className="font-display font-bold tracking-wide">{MONTH_NAMES[viewMonth.month].toUpperCase()} {viewMonth.year}</div>
            <button onClick={() => setViewMonth((v) => { const m = v.month === 11 ? 0 : v.month + 1; const y = v.month === 11 ? v.year + 1 : v.year; return { year: y, month: m }; })} className="cv-icon-btn p-1">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 cv-faint font-mono text-[10px] mb-2 tracking-widest">{DOW.map((d, i) => <div key={i} className="text-center">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map((d, i) => {
              if (!d) return <div key={i} />;
              const past = d < today;
              const onVacation = !past && myVacations.some((v) => d >= toDateOnly(v.start_date) && d <= toDateOnly(v.end_date));
              const manuallyBlocked = blockedDates.some((r) => r.member_id === viewingAs && r.blocked_date === toDateInput(d));
              const recurringHit = recurringOff.some((r) => r.member_id === viewingAs && r.weekday === d.getDay());
              const disabled = past || isWeekend(d) || !isSelf;
              let cls = "cv-day";
              if (past || isWeekend(d)) cls = "cv-day-disabled";
              else if (onVacation) cls = "cv-day-vacation";
              else if (manuallyBlocked || recurringHit) cls = "cv-day-blocked";
              return (
                <button key={i} disabled={disabled || onVacation} onClick={() => toggleBlock(d)} className={`relative aspect-square text-sm font-mono flex items-center justify-center ${cls}`}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="cv-graphite font-mono text-[11px] tracking-widest mb-3 uppercase">Recurring days off</div>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((dow) => {
                const active = recurringOff.some((r) => r.member_id === viewingAs && r.weekday === dow);
                return <button key={dow} disabled={!isSelf} onClick={() => toggleRecurring(dow)} className={`cv-daytoggle px-3 py-1.5 font-mono text-xs uppercase ${active ? "cv-daytoggle-active" : ""}`}>{WEEKDAY_LABELS[dow]}</button>;
              })}
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-8">
          {isSelf && (
            <Panel className="cv-card w-full">
              <div className="cv-graphite font-mono text-[11px] tracking-widest mb-1 uppercase">Time off range</div>
              <div className="space-y-3">
                <Field label="Starts"><input type="date" value={vacStart} onChange={(e) => setVacStart(e.target.value)} className="cv-input w-full py-2" /></Field>
                <Field label="Ends"><input type="date" value={vacEnd} onChange={(e) => setVacEnd(e.target.value)} className="cv-input w-full py-2" /></Field>
                <Field label="Label"><input value={vacLabel} onChange={(e) => setVacLabel(e.target.value)} className="cv-input w-full py-2" placeholder="Vacation" /></Field>
                <button onClick={submitVacation} disabled={!vacStart} className="cv-btn-primary w-full px-4 py-2 font-mono text-xs tracking-widest uppercase">Add time off</button>
              </div>
              <div className="mt-5 space-y-2">
                {myVacations.length === 0 && <div className="cv-faint text-sm italic">No time off scheduled.</div>}
                {myVacations.map((v) => (
                  <div key={v.id} className="cv-row flex items-center justify-between px-3 py-2">
                    <div><div className="text-sm font-semibold">{v.label}</div><div className="font-mono text-xs cv-graphite">{v.start_date} – {v.end_date}</div></div>
                    <button onClick={() => removeVacation(v.id)} className="cv-x-btn">✕</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {isSelf && (
            <Panel className="cv-card w-full">
              <div className="cv-graphite font-mono text-[11px] tracking-widest mb-1 uppercase">Time off during the day</div>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setPartRecurring(true)} className={`cv-daytoggle flex-1 px-3 py-1.5 font-mono text-[11px] uppercase ${partRecurring ? "cv-daytoggle-active" : ""}`}>Every day</button>
                <button onClick={() => setPartRecurring(false)} className={`cv-daytoggle flex-1 px-3 py-1.5 font-mono text-[11px] uppercase ${!partRecurring ? "cv-daytoggle-active" : ""}`}>One date</button>
              </div>
              <div className="space-y-3">
                {!partRecurring && <Field label="Date"><input type="date" value={partDate} onChange={(e) => setPartDate(e.target.value)} className="cv-input w-full py-2" /></Field>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From"><input type="time" value={partStart} onChange={(e) => setPartStart(e.target.value)} className="cv-input w-full py-2" /></Field>
                  <Field label="To"><input type="time" value={partEnd} onChange={(e) => setPartEnd(e.target.value)} className="cv-input w-full py-2" /></Field>
                </div>
                <Field label="Label"><input value={partLabel} onChange={(e) => setPartLabel(e.target.value)} className="cv-input w-full py-2" /></Field>
                <button onClick={submitPartialBlock} className="cv-btn-primary w-full px-4 py-2 font-mono text-xs tracking-widest uppercase">Add time off</button>
              </div>
              <div className="mt-5 space-y-2">
                {myPartials.length === 0 && <div className="cv-faint text-sm italic">No daily breaks set.</div>}
                {myPartials.map((p) => (
                  <div key={p.id} className="cv-row flex items-center justify-between px-3 py-2">
                    <div><div className="text-sm font-semibold">{p.label}</div><div className="font-mono text-xs cv-graphite">{p.start_minutes}–{p.end_minutes} min · {p.recurring ? "Every day" : p.block_date}</div></div>
                    <button onClick={() => removePartialBlock(p.id)} className="cv-x-btn">✕</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      <div className="mt-10">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-3 uppercase">Team overview — next 14 days</div>
        <div className="cv-card overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid" style={{ gridTemplateColumns: `140px repeat(14, 1fr)` }}>
              <div className="cv-row-head p-2" />
              {next14.map((d, i) => (
                <div key={i} className={`cv-row-head p-2 text-center font-mono text-[9px] tracking-widest ${isWeekend(d) ? "cv-faint" : "cv-graphite"}`}>
                  {d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2).toUpperCase()}<div>{d.getDate()}</div>
                </div>
              ))}
            </div>
            {members.map((m) => (
              <div key={m.id} className="grid" style={{ gridTemplateColumns: `140px repeat(14, 1fr)` }}>
                <div className="cv-row-head p-2 font-semibold text-sm flex items-center gap-2">
                  <span className="cv-pill-badge font-mono text-[9px] w-5 h-5 flex items-center justify-center border">{m.initials}</span>{m.name}
                </div>
                {next14.map((d, i) => {
                  const blocked = isMemberBlockedOnDate(m.id, d, index);
                  return (
                    <div key={i} className="cv-row-head flex items-center justify-center py-2">
                      {isWeekend(d) ? <span className="cv-legend-weekend w-3 h-3 inline-block" /> : blocked ? <span className="cv-icon-stamp text-xs">✕</span> : <span className="cv-dot-ink w-2 h-2 rounded-full inline-block" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
