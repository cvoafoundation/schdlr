// Pure scheduling logic — no network calls in here. Pages fetch rows from
// Supabase and pass them in; these functions do the same date-math the
// original prototype did, just against real data shapes.

export const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (d) => d.toDateString();
export const fmtTime = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
export const isSameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
export const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
export const overlaps = (aStart, aDur, bStart, bDur) => aStart < bStart + bDur && bStart < aStart + aDur;
export const toDateOnly = (isoDateString) => {
  // "2026-07-04" -> local midnight Date, avoiding UTC-shift bugs
  const [y, m, d] = isoDateString.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Build fast-lookup indexes from raw Supabase rows. */
export function buildAvailabilityIndex({ blockedDates = [], recurringOff = [], vacations = [], partialBlocks = [] }) {
  const blocked = {};
  blockedDates.forEach((r) => {
    (blocked[r.member_id] ||= new Set()).add(r.blocked_date); // already "YYYY-MM-DD"
  });
  const recurring = {};
  recurringOff.forEach((r) => {
    (recurring[r.member_id] ||= new Set()).add(r.weekday);
  });
  const vacs = {};
  vacations.forEach((r) => {
    (vacs[r.member_id] ||= []).push({ id: r.id, start: toDateOnly(r.start_date), end: toDateOnly(r.end_date), label: r.label });
  });
  const partials = {};
  partialBlocks.forEach((r) => {
    (partials[r.member_id] ||= []).push({
      id: r.id, recurring: r.recurring, date: r.block_date ? toDateOnly(r.block_date) : null,
      start: r.start_minutes, end: r.end_minutes, label: r.label,
    });
  });
  return { blocked, recurring, vacs, partials };
}

export function isMemberBlockedOnDate(memberId, date, index) {
  if (isWeekend(date)) return true;
  if (index.recurring[memberId]?.has(date.getDay())) return true;
  if (index.blocked[memberId]?.has(toDateInput(date))) return true;
  return (index.vacs[memberId] || []).some((v) => date >= v.start && date <= v.end);
}

function getMeetingBlocks(memberId, date, bookings) {
  // A couple of deterministic "seed" busy blocks so a brand-new org still
  // sees a realistic-looking calendar before real bookings pile up. Remove
  // this once you have real usage, or leave it — it never blocks a whole day.
  const hash1 = simpleHash(`${dateKey(date)}-${memberId}-a`);
  const hash2 = simpleHash(`${dateKey(date)}-${memberId}-b`);
  const busy = [];
  if (hash1 % 3 !== 0) busy.push({ start: 9 * 60 + (hash1 % 6) * 60, duration: 30 });
  if (hash2 % 4 === 0) busy.push({ start: 10 * 60 + (hash2 % 5) * 60, duration: 60 });
  bookings
    .filter((b) => b.member_id === memberId && !b.is_group && isSameDay(toDateOnly(b.booking_date), date) && b.status !== "canceled")
    .forEach((b) => busy.push({ start: b.start_minutes, duration: b.duration_minutes }));
  return busy;
}

function getBusyBlocks(memberId, date, bookings, index) {
  const busy = getMeetingBlocks(memberId, date, bookings);
  (index.partials[memberId] || [])
    .filter((p) => p.recurring || (p.date && isSameDay(p.date, date)))
    .forEach((p) => busy.push({ start: p.start, duration: p.end - p.start }));
  return busy;
}

export function meetingCount(memberId, date, bookings) {
  return getMeetingBlocks(memberId, date, bookings).length;
}

export function getSlotsForMember(date, duration, memberId, settings, bookings, index) {
  const busy = getBusyBlocks(memberId, date, bookings, index);
  const now = new Date();
  const isToday = isSameDay(date, now);
  const noticeCutoff = now.getHours() * 60 + now.getMinutes() + settings.notice_hours * 60;
  const slots = [];
  let t = 9 * 60;
  while (t + duration <= 17 * 60) {
    let booked = busy.some((b) => overlaps(t, duration, b.start - settings.buffer_minutes, b.duration + settings.buffer_minutes * 2));
    if (isToday && t < noticeCutoff) booked = true;
    slots.push({ label: fmtTime(t), minutes: t, booked });
    t += duration;
  }
  return slots;
}

export function findEarliestSlot(duration, memberId, teamIds, settings, bookings, index, maxDays = 45) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = 0; i < maxDays; i++) {
    const date = addDays(start, i);
    if (isWeekend(date)) continue;
    if (memberId === "any") {
      const eligible = teamIds.filter((id) => !isMemberBlockedOnDate(id, date, index) && meetingCount(id, date, bookings) < settings.daily_cap);
      for (const id of eligible) {
        const free = getSlotsForMember(date, duration, id, settings, bookings, index).find((s) => !s.booked);
        if (free) return { date, slot: free, memberId: id };
      }
    } else {
      if (isMemberBlockedOnDate(memberId, date, index) || meetingCount(memberId, date, bookings) >= settings.daily_cap) continue;
      const free = getSlotsForMember(date, duration, memberId, settings, bookings, index).find((s) => !s.booked);
      if (free) return { date, slot: free };
    }
  }
  return null;
}

export function icsFileFor(booking, hostName) {
  const icsDate = (dateObj, minutes) => {
    const d = new Date(dateObj);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const p2 = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "T" + p2(d.getHours()) + p2(d.getMinutes()) + "00";
  };
  const start = icsDate(booking.date, booking.minutes);
  const end = icsDate(booking.date, booking.minutes + booking.duration);
  const now = new Date();
  const stamp = icsDate(now, now.getHours() * 60 + now.getMinutes());
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CVOA Foundation//Scheduling//EN", "BEGIN:VEVENT",
    `UID:${booking.id}@cvoa.org`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${booking.duration} Minute Meeting with ${hostName}`,
    `DESCRIPTION:Guest: ${booking.guest_name || ""} (${booking.guest_email || ""})`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(booking, hostName) {
  const blob = new Blob([icsFileFor(booking, hostName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `meeting-${booking.id}.ics`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
