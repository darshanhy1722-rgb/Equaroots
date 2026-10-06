import type { Patient } from './api';

const TZ = 'Asia/Kolkata';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar day (YYYY-MM-DD) in India time. */
export function istDay(d: Date | string): string {
  return dayFmt.format(typeof d === 'string' ? new Date(d) : d);
}

export type When = 'today' | 'upcoming' | 'past' | 'nodate';

export function whenOf(p: Pick<Patient, 'startTime'>, now = new Date()): When {
  if (!p.startTime) return 'nodate';
  const day = istDay(p.startTime);
  const today = istDay(now);
  if (day === today) return 'today';
  return day > today ? 'upcoming' : 'past';
}

const t = (s: string | null) => (s ? new Date(s).getTime() : 0);

/** Today and upcoming soonest-first; past most-recent-first; undated newest-added first. */
export function sortForSection(list: Patient[], when: When): Patient[] {
  const out = [...list];
  if (when === 'today' || when === 'upcoming') out.sort((a, b) => t(a.startTime) - t(b.startTime));
  else if (when === 'past') out.sort((a, b) => t(b.startTime) - t(a.startTime));
  else out.sort((a, b) => b.bookingId - a.bookingId);
  return out;
}

export function relativeDay(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const day = istDay(iso);
  const today = istDay(now);
  const tomorrow = istDay(new Date(now.getTime() + 864e5));
  if (day === today) return 'Today';
  if (day === tomorrow) return 'Tomorrow';
  return '';
}
