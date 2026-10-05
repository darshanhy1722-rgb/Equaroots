import type { Viewer } from '../auth.js';
import type { Queryable } from '../db.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface BookingRow {
  id: number;
  cal_uid: string | null;
  patient_id: string | null;
  patient_type: string | null;
  patient_name: string;
  age: string | null;
  gender: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  doctor_id: number | null;
  doctor_name_raw: string | null;
  doctor_email_raw: string | null;
  start_time: Date | null;
  end_time: Date | null;
  meet_link: string | null;
  description: string | null;
  status: string;
  pdf_url: string | null;
  doctor_email: string | null;
  doctor_display_name: string | null;
}

/** Loads a booking and enforces: booking.doctor.email === viewer OR viewer is admin. */
export async function loadBookingForViewer(db: Queryable, viewer: Viewer, bookingId: number): Promise<BookingRow> {
  if (!Number.isInteger(bookingId) || bookingId <= 0) throw new HttpError(400, 'invalid booking id');
  const { rows } = await db.query<BookingRow>(
    `select b.*, d.email as doctor_email, d.display_name as doctor_display_name
       from bookings b left join doctors d on d.id = b.doctor_id where b.id = $1`,
    [bookingId],
  );
  const b = rows[0];
  if (!b) throw new HttpError(404, 'booking not found');
  const own = !!b.doctor_email && b.doctor_email.toLowerCase() === viewer.email.toLowerCase();
  if (!own && !viewer.isAdmin) throw new HttpError(403, 'not your patient');
  return b;
}
