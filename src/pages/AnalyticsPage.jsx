import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Panel, LoadingBlock, ErrorBlock } from "../components/ui.jsx";
import { addDays, isSameDay, toDateOnly } from "../lib/scheduling.js";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function MiniBar({ label, value, max, suffix = "" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="font-mono text-[10px] tracking-widest w-16 cv-graphite uppercase shrink-0">{label}</div>
      <div className="flex-1 h-4 cv-bar-track relative">
        <div className="cv-bar-fill h-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="font-mono text-xs w-14 text-right shrink-0">{value}{suffix}</div>
    </div>
  );
}

function toCsvValue(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookings, setBookings] = useState([]);
  const [members, setMembers] = useState([]);

  useEffect(() => {
    async function load() {
      setLoading(true); setError("");
      const [b, m] = await Promise.all([
        supabase.from("bookings").select("*").order("booking_date"),
        supabase.from("team_members").select("*").order("name"),
      ]);
      if (b.error) setError(b.error.message);
      setBookings(b.data || []);
      setMembers(m.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const active = useMemo(() => bookings.filter((b) => b.status !== "canceled" && b.event_type_id !== "group"), [bookings]);

  const weekdayCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    active.forEach((b) => { const dow = toDateOnly(b.booking_date).getDay(); if (dow >= 1 && dow <= 5) counts[dow - 1]++; });
    return counts;
  }, [active]);
  const maxWeekday = Math.max(1, ...weekdayCounts);

  const perMember = useMemo(() => members.map((m) => {
    const mine = active.filter((b) => b.member_id === m.id);
    const completed = mine.filter((b) => b.status === "completed").length;
    const noshow = mine.filter((b) => b.status === "no-show").length;
    const total = completed + noshow;
    return { member: m, rate: total ? Math.round((noshow / total) * 100) : null, total, noshow };
  }), [members, active]);
  const maxNoShow = Math.max(1, 20, ...perMember.map((p) => p.rate || 0));

  const avgLead = useMemo(() => {
    const withCreated = active.filter((b) => b.created_at);
    if (!withCreated.length) return null;
    const totalDays = withCreated.reduce((sum, b) => sum + Math.max(0, (toDateOnly(b.booking_date) - new Date(b.created_at)) / 86400000), 0);
    return totalDays / withCreated.length;
  }, [active]);

  const trend = useMemo(() => {
    const last14 = Array.from({ length: 14 }, (_, i) => addDays(addDays(today, -13), i));
    return last14.map((d) => ({ date: d, count: active.filter((b) => b.created_at && isSameDay(new Date(b.created_at), d)).length }));
  }, [active]);
  const maxTrend = Math.max(1, ...trend.map((t) => t.count));

  const busiestIdx = weekdayCounts.indexOf(Math.max(...weekdayCounts));

  function exportCsv() {
    const memberName = (id) => members.find((m) => m.id === id)?.name || "";
    const headers = ["date", "time", "duration_minutes", "team_member", "guest_name", "guest_email", "status", "urgent", "created_at"];
    const rows = bookings.map((b) => [
      b.booking_date, b.start_minutes, b.duration_minutes, memberName(b.member_id),
      b.guest_name, b.guest_email, b.status, b.urgent ? "yes" : "no", b.created_at,
    ]);
    const csv = [headers, ...rows].map((r) => r.map(toCsvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bookings-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingBlock label="Crunching the numbers…" />;

  return (
    <div className="space-y-8">
      {error && <ErrorBlock message={error} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="cv-graphite font-mono text-[11px] tracking-widest uppercase">{active.length} meetings tracked</div>
        <button onClick={exportCsv} className="cv-btn-outline px-4 py-2 font-mono text-xs tracking-widest uppercase">⬇ Export all bookings (.csv)</button>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Panel className="cv-card text-center py-6">
          <div className="font-display text-3xl font-bold">{active.length}</div>
          <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mt-1">Total meetings tracked</div>
        </Panel>
        <Panel className="cv-card text-center py-6">
          <div className="font-display text-3xl font-bold">{avgLead !== null ? avgLead.toFixed(1) : "—"}</div>
          <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mt-1">Avg. days booked ahead</div>
        </Panel>
        <Panel className="cv-card text-center py-6">
          <div className="font-display text-3xl font-bold">{Math.max(...weekdayCounts) > 0 ? WEEKDAY_LABELS[1 + busiestIdx] : "—"}</div>
          <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mt-1">Busiest weekday</div>
        </Panel>
      </div>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-4">Bookings by weekday</div>
        <div className="space-y-3">
          {weekdayCounts.map((c, i) => <MiniBar key={i} label={WEEKDAY_LABELS[i + 1]} value={c} max={maxWeekday} />)}
        </div>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">No-show rate by specialist</div>
        <div className="cv-graphite text-sm mb-4">Based on meetings marked completed or no-show.</div>
        <div className="space-y-3">
          {perMember.map((p) => <MiniBar key={p.member.id} label={p.member.initials} value={p.rate ?? 0} max={maxNoShow} suffix={p.total ? "%" : " n/a"} />)}
          {perMember.length === 0 && <div className="cv-faint text-sm italic">No team members yet.</div>}
        </div>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">Booking volume — last 14 days</div>
        <div className="cv-graphite text-sm mb-4">New bookings created each day.</div>
        <div className="flex items-end gap-1.5 h-28">
          {trend.map((t, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${t.date.toLocaleDateString()}: ${t.count}`}>
              <div className="cv-bar-fill w-full" style={{ height: `${Math.max(4, (t.count / maxTrend) * 100)}%` }} />
              <div className="font-mono text-[8px] cv-faint">{t.date.getDate()}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
