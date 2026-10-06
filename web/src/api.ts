export interface Doctor {
  id: number;
  display_name: string;
  role: string | null;
  reg_no: string | null;
  email: string;
  designation?: string | null;
  highlight?: string | null;
  hasSignature?: boolean;
}
export interface AdminDoctor extends Doctor {
  signature_url: string | null;
  bookings: number;
}
export interface WebhookLog {
  id: number;
  receivedAt: string;
  ok: boolean;
  triggerEvent: string | null;
  calUid: string | null;
  note: string | null;
}
export interface Medicine {
  id: number;
  name: string;
  notes: string | null;
}
export interface Bootstrap {
  authorized: boolean;
  isAdmin: boolean;
  email: string;
  doctor: Doctor | null;
  myDoctors: Doctor[];
  doctors: Doctor[];
  medicines: Medicine[];
}
export interface Patient {
  bookingId: number;
  patientId: string | null;
  patientType: 'New' | 'Existing' | null;
  name: string;
  age: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  doctorId: number | null;
  doctorName: string | null;
  startTime: string | null;
  meetLink: string | null;
  description: string | null;
  status: string;
  hasPdf: boolean;
  rxStatus: 'Draft' | 'Sent' | null;
  prescriptionId: string | null;
}
export interface MedLine {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes: string;
}
export interface Draft {
  prescriptionId: string;
  status: 'Draft' | 'Sent';
  impression: string;
  progression: string;
  advice: string;
  medicines: MedLine[];
  approvedAt: string | null;
  updatedAt: string;
}
export interface HistoryItem {
  id: number;
  bookingId: number;
  prescriptionId: string;
  status: string;
  impression: string | null;
  progression: string | null;
  advice: string | null;
  medicines: MedLine[] | null;
  doctorName: string | null;
  consultationAt: string | null;
  createdAt: string;
  pdfUrl: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (body && body.error) || `HTTP ${res.status}`, body);
  return body as T;
}

export const api = {
  authConfig: () => req<{ googleClientId: string | null; devLogin: boolean }>('/api/auth/config'),
  googleLogin: (credential: string) => req('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  devLogin: (email: string) => req('/api/auth/dev-login', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  bootstrap: () => req<Bootstrap>('/api/bootstrap'),
  patients: (doctorId?: number | null) =>
    req<{ patients: Patient[] }>(`/api/patients${doctorId ? `?doctor_id=${doctorId}` : ''}`).then((r) => r.patients),
  draft: (bookingId: number) =>
    req<{ draft: Draft | null; pdfUrl: string | null }>(`/api/bookings/${bookingId}/draft`),
  history: (patientId: string, excludeBookingId: number) =>
    req<{ history: HistoryItem[] }>(
      `/api/patients/${encodeURIComponent(patientId)}/history?exclude_booking_id=${excludeBookingId}`,
    ).then((r) => r.history),
  save: (action: 'draft' | 'send', body: { bookingId: number; impression: string; progression: string; advice: string; medicines: MedLine[] }) =>
    req<{ status: string; prescriptionId: string; pdfUrl?: string }>(`/api/prescriptions?action=${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSignature: (doctorId: number) =>
    req<{ signature: string | null }>(`/api/doctors/${doctorId}/signature`).then((r) => r.signature),
  setSignature: (doctorId: number, signature: string | null) =>
    req(`/api/doctors/${doctorId}/signature`, { method: 'PUT', body: JSON.stringify({ signature }) }),
  adminDoctors: () => req<{ doctors: AdminDoctor[] }>('/api/admin/doctors').then((r) => r.doctors),
  createDoctor: (d: Partial<Doctor>) => req('/api/admin/doctors', { method: 'POST', body: JSON.stringify(d) }),
  updateDoctor: (id: number, d: Partial<Doctor>) =>
    req(`/api/admin/doctors/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteDoctor: (id: number) => req(`/api/admin/doctors/${id}`, { method: 'DELETE' }),
  addMedicine: (name: string, notes: string) =>
    req<{ medicine: Medicine }>('/api/admin/medicines', { method: 'POST', body: JSON.stringify({ name, notes }) }).then(
      (r) => r.medicine,
    ),
  deleteMedicine: (id: number) => req(`/api/admin/medicines/${id}`, { method: 'DELETE' }),
  webhookLogs: () => req<{ logs: WebhookLog[] }>('/api/admin/webhook-logs?limit=100').then((r) => r.logs),
  importCsv: (files: Record<string, string>) =>
    req<{ text: string }>('/api/admin/import-csv', { method: 'POST', body: JSON.stringify(files) }).then((r) => r.text),
  async preview(bookingId: number, body: { impression: string; progression: string; advice: string; medicines: MedLine[] }): Promise<Blob> {
    const res = await fetch(`/api/prescriptions/${bookingId}/preview`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`);
    }
    return res.blob();
  },
};
