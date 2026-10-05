import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { clearSession, issueSession, requireAdmin, requireAuthorized, requireSession, verifyGoogleCredential } from './auth.js';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, loadBookingForViewer } from './services/access.js';
import { listDoctors, upsertDoctorByName, validateSignature, type Doctor } from './services/doctors.js';
import { approveAndSend, latestConsultation, previewPdf, sanitizeInput, saveDraft } from './services/prescriptions.js';
import { rotateCalWebhookSecret } from './services/settings.js';
import { formatSummary, importSheetData } from './services/sheetImport.js';
import { readLocalSigned, signedPdfUrl } from './services/storage.js';
import { handleCalWebhook } from './services/webhook.js';

const here = path.dirname(fileURLToPath(import.meta.url));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Liveness for the platform healthcheck; reports DB status without failing on it.
  app.get('/healthz', async (_req, res) => {
    const db = await pool.query('select 1').then(() => true, () => false);
    res.json({ ok: true, db });
  });

  // ── Cal.id webhook: raw body, HMAC verified before parsing (spec §7) ──
  app.post('/api/webhooks/cal', express.raw({ type: '*/*', limit: '2mb' }), h(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const out = await handleCalWebhook(raw, req.header('x-cal-signature-256'));
    res.status(out.status).json(out.body);
  }));

  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // ── Auth ──
  app.get('/api/auth/config', (_req, res) => {
    res.json({ googleClientId: config.googleClientId || null, devLogin: config.devLogin });
  });

  app.post('/api/auth/google', h(async (req, res) => {
    let email: string;
    try {
      email = await verifyGoogleCredential(String(req.body?.credential ?? ''));
    } catch (e: any) {
      return res.status(401).json({ ok: false, error: e?.message ?? 'sign-in failed' });
    }
    issueSession(res, email);
    res.json({ ok: true, email });
  }));

  if (config.devLogin) {
    console.warn('[auth] AUTH_DEV_LOGIN=true — passwordless dev login is ENABLED. Never use in production.');
    app.post('/api/auth/dev-login', h(async (req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'email required' });
      issueSession(res, email);
      res.json({ ok: true, email });
    }));
  }

  app.post('/api/auth/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  // ── Bootstrap (mirrors getBootstrapData) ──
  app.get('/api/bootstrap', requireSession, h(async (req, res) => {
    const v = req.viewer!;
    if (!v.authorized) {
      return res.json({ authorized: false, isAdmin: false, email: v.email, doctor: null, doctors: [], medicines: [] });
    }
    const [doctors, meds] = await Promise.all([
      listDoctors(pool),
      pool.query('select id, name, notes from medicines order by name'),
    ]);
    // Signatures are large data URLs; the list only says whether one exists.
    const slim = ({ signature_url, ...d }: Doctor) => ({ ...d, hasSignature: !!signature_url });
    const mine = new Set(v.doctors.map((d) => d.id));
    res.json({
      authorized: true,
      isAdmin: v.isAdmin,
      email: v.email,
      doctor: v.doctor && slim(v.doctor),
      myDoctors: v.doctors.map(slim),
      doctors: (v.isAdmin ? doctors : doctors.filter((d) => mine.has(d.id))).map(slim),
      medicines: meds.rows,
    });
  }));

  const authed = express.Router();
  authed.use(requireSession, requireAuthorized);

  // ── Patients ──
  authed.get('/patients', h(async (req, res) => {
    const v = req.viewer!;
    const params: unknown[] = [];
    let where = '';
    if (v.isAdmin) {
      const did = Number(req.query.doctor_id);
      if (req.query.doctor_id && Number.isInteger(did)) {
        params.push(did);
        where = `where b.doctor_id = $1`;
      }
    } else {
      params.push(v.doctors.map((d) => d.id));
      where = `where b.doctor_id = any($1::int[])`;
    }
    const { rows } = await pool.query(
      `select b.id as "bookingId", b.cal_uid as "calUid", b.patient_id as "patientId", b.patient_type as "patientType",
              b.patient_name as "name", b.age, b.gender, b.patient_email as "email", b.patient_phone as "phone",
              b.doctor_id as "doctorId", coalesce(d.display_name, b.doctor_name_raw) as "doctorName",
              b.start_time as "startTime", b.end_time as "endTime", b.meet_link as "meetLink",
              b.description, b.status, (b.pdf_url is not null) as "hasPdf",
              c.status as "rxStatus", c.prescription_id as "prescriptionId"
         from bookings b
         left join doctors d on d.id = b.doctor_id
         left join lateral (select status, prescription_id from consultations
                             where booking_id = b.id order by updated_at desc, id desc limit 1) c on true
         ${where}
         order by b.start_time desc nulls last, b.id desc`,
      params,
    );
    res.json({ ok: true, patients: rows });
  }));

  authed.get('/patients/:patientId/history', h(async (req, res) => {
    const v = req.viewer!;
    const pid = String(req.params.patientId);
    const exclude = Number(req.query.exclude_booking_id ?? req.query.excludeBookingId ?? 0) || 0;
    if (!v.isAdmin) {
      const { rowCount } = await pool.query('select 1 from bookings where patient_id=$1 and doctor_id = any($2::int[]) limit 1', [
        pid,
        v.doctors.map((d) => d.id),
      ]);
      if (!rowCount) throw new HttpError(403, 'not your patient');
    }
    const { rows } = await pool.query(
      `select c.id, c.booking_id as "bookingId", c.prescription_id as "prescriptionId", c.status, c.impression, c.advice,
              c.medicines_json as medicines, c.approved_at as "approvedAt", c.created_at as "createdAt",
              d.display_name as "doctorName", b.start_time as "consultationAt", c.pdf_url as "pdfKey"
         from consultations c left join doctors d on d.id = c.doctor_id left join bookings b on b.id = c.booking_id
        where c.patient_uid = $1 and c.booking_id is distinct from $2
        order by coalesce(b.start_time, c.created_at) desc`,
      [pid, exclude || null],
    );
    const history = await Promise.all(
      rows.map(async ({ pdfKey, ...r }) => ({ ...r, pdfUrl: pdfKey && !/^https?:/.test(pdfKey) ? await signedPdfUrl(pdfKey) : pdfKey })),
    );
    res.json({ ok: true, history });
  }));

  authed.get('/bookings/:bookingId/draft', h(async (req, res) => {
    const b = await loadBookingForViewer(pool, req.viewer!, Number(req.params.bookingId));
    const c = await latestConsultation(pool, b.id);
    const pdfKey = c?.pdf_url ?? b.pdf_url;
    res.json({
      ok: true,
      draft: c && {
        prescriptionId: c.prescription_id,
        status: c.status,
        impression: c.impression ?? '',
        advice: c.advice ?? '',
        medicines: c.medicines_json ?? [],
        approvedAt: c.approved_at,
        updatedAt: c.updated_at,
      },
      pdfUrl: pdfKey ? (/^https?:/.test(pdfKey) ? pdfKey : await signedPdfUrl(pdfKey)) : null,
    });
  }));

  // ── Prescriptions ──
  authed.post('/prescriptions', h(async (req, res) => {
    const action = String(req.query.action ?? req.body?.action ?? 'draft');
    const bookingId = Number(req.body?.bookingId);
    const input = sanitizeInput(req.body);
    if (action === 'draft') {
      const c = await saveDraft(req.viewer!, bookingId, input);
      return res.json({ ok: true, status: c.status, prescriptionId: c.prescription_id, savedAt: c.updated_at });
    }
    if (action === 'send') {
      const { consultation, pdfUrl } = await approveAndSend(req.viewer!, bookingId, input);
      return res.json({ ok: true, status: 'Sent', prescriptionId: consultation.prescription_id, pdfUrl });
    }
    throw new HttpError(400, 'action must be draft or send');
  }));

  const sendPreview = (inline: boolean) => h(async (req, res) => {
    const input = req.method === 'POST' ? sanitizeInput(req.body) : null;
    const { pdf, prescriptionId } = await previewPdf(req.viewer!, Number(req.params.bookingId), input);
    if (req.query.format === 'base64') return res.json({ ok: true, prescriptionId, base64: pdf.toString('base64') });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${prescriptionId}-preview.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  });
  authed.get('/prescriptions/:bookingId/preview', sendPreview(true));
  authed.post('/prescriptions/:bookingId/preview', sendPreview(true));


  // ── Doctor signatures: an admin, or the doctor themself (same login email) ──
  const canEditDoctor = async (req: Request, doctorId: number) => {
    const v = req.viewer!;
    const { rows } = await pool.query<Doctor>('select * from doctors where id=$1', [doctorId]);
    const d = rows[0];
    if (!d) throw new HttpError(404, 'doctor not found');
    if (!v.isAdmin && d.email.toLowerCase() !== v.email.toLowerCase()) throw new HttpError(403, 'not your profile');
    return d;
  };

  authed.get('/doctors/:id/signature', h(async (req, res) => {
    const d = await canEditDoctor(req, Number(req.params.id));
    res.json({ ok: true, signature: d.signature_url });
  }));

  authed.put('/doctors/:id/signature', h(async (req, res) => {
    await canEditDoctor(req, Number(req.params.id));
    let sig: string | null;
    try {
      sig = validateSignature(req.body?.signature);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    await pool.query('update doctors set signature_url=$2 where id=$1', [Number(req.params.id), sig]);
    res.json({ ok: true, hasSignature: !!sig });
  }));

  // ── Admin: doctors ──
  const doctorBody = (b: any) => {
    const display_name = String(b?.display_name ?? '').trim();
    const email = String(b?.email ?? '').trim().toLowerCase();
    if (!display_name) throw new HttpError(400, 'Name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'A valid email is required');
    return {
      display_name,
      email,
      role: String(b?.role ?? '').trim() || null,
      reg_no: String(b?.reg_no ?? '').trim() || null,
    };
  };

  authed.get('/admin/doctors', requireAdmin, h(async (_req, res) => {
    const { rows } = await pool.query(
      `select d.id, d.display_name, d.role, d.reg_no, d.email, d.signature_url,
              (select count(*)::int from bookings b where b.doctor_id = d.id) as bookings
         from doctors d order by d.display_name`,
    );
    res.json({ ok: true, doctors: rows });
  }));

  authed.post('/admin/doctors', requireAdmin, h(async (req, res) => {
    const d = doctorBody(req.body);
    const dup = await pool.query(
      `select 1 from doctors where regexp_replace(lower(display_name),'[^a-z0-9]','','g') = regexp_replace(lower($1),'[^a-z0-9]','','g')`,
      [d.display_name],
    );
    if (dup.rowCount) throw new HttpError(409, `${d.display_name} already exists — edit that doctor instead.`);
    await upsertDoctorByName(pool, d);
    // Link bookings that arrived before this doctor existed.
    await pool.query(
      `update bookings b set doctor_id = d.id from doctors d
        where b.doctor_id is null and d.display_name = $1
          and regexp_replace(lower(coalesce(b.doctor_name_raw,'')),'[^a-z0-9]','','g') = regexp_replace(lower(d.display_name),'[^a-z0-9]','','g')`,
      [d.display_name],
    );
    res.json({ ok: true });
  }));

  authed.put('/admin/doctors/:id', requireAdmin, h(async (req, res) => {
    const d = doctorBody(req.body);
    const r = await pool.query('update doctors set display_name=$2, role=$3, reg_no=$4, email=$5 where id=$1', [
      Number(req.params.id), d.display_name, d.role, d.reg_no, d.email,
    ]);
    if (!r.rowCount) throw new HttpError(404, 'doctor not found');
    res.json({ ok: true });
  }));

  authed.delete('/admin/doctors/:id', requireAdmin, h(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await pool.query<{ n: number }>(
      'select (select count(*) from bookings where doctor_id=$1) + (select count(*) from consultations where doctor_id=$1) as n',
      [id],
    );
    if (Number(rows[0].n) > 0) throw new HttpError(409, 'This doctor has bookings or prescriptions and can’t be deleted. Edit them instead.');
    await pool.query('delete from doctors where id=$1', [id]);
    res.json({ ok: true });
  }));

  // ── Admin: medicines ──
  authed.post('/admin/medicines', requireAdmin, h(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Name is required');
    const { rowCount } = await pool.query('select 1 from medicines where lower(name)=lower($1)', [name]);
    if (rowCount) throw new HttpError(409, `${name} is already in the list`);
    const { rows } = await pool.query('insert into medicines(name, notes) values ($1,$2) returning id, name, notes', [
      name, String(req.body?.notes ?? '').trim() || null,
    ]);
    res.json({ ok: true, medicine: rows[0] });
  }));

  authed.delete('/admin/medicines/:id', requireAdmin, h(async (req, res) => {
    await pool.query('delete from medicines where id=$1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // ── Admin ──
  authed.post('/admin/import-csv', requireAdmin, h(async (req, res) => {
    const { doctors, medicines, bookings, consultations } = req.body ?? {};
    const summary = await importSheetData(pool, { doctors, medicines, bookings, consultations });
    res.json({ ok: true, summary, text: formatSummary(summary) });
  }));

  authed.post('/admin/reassign-token', requireAdmin, h(async (_req, res) => {
    const secret = await rotateCalWebhookSecret(pool);
    res.json({
      ok: true,
      secret,
      webhookUrl: `${config.appBaseUrl}/api/webhooks/cal`,
      note: "Paste this into Cal.id → Settings → Developer → Webhooks → Secret. It won't be shown again.",
    });
  }));

  authed.get('/admin/webhook-logs', requireAdmin, h(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const { rows } = await pool.query(
      'select id, received_at as "receivedAt", ok, trigger_event as "triggerEvent", cal_uid as "calUid", note from webhook_logs order by id desc limit $1',
      [limit],
    );
    res.json({ ok: true, logs: rows });
  }));

  app.use('/api', authed);

  // Local-storage signed PDF downloads (only used when no S3 bucket is configured).
  app.get(/^\/files\/(.+)$/, h(async (req, res) => {
    const k = decodeURI((req.params as any)[0] as string);
    const buf = await readLocalSigned(k, String(req.query.exp ?? ''), String(req.query.sig ?? ''));
    if (!buf) return res.status(403).send('Link expired or invalid');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(k)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }));

  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'not found' }));

  // ── Frontend (built Vite app) ──
  const webDist = [path.resolve(here, '../../web/dist'), path.resolve(here, '../../../web/dist')].find((p) =>
    fs.existsSync(path.join(p, 'index.html')),
  );
  if (webDist) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|files\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ ok: false, error: err.message });
    console.error(err);
    res.status(500).json({ ok: false, error: 'internal error' });
  });

  return app;
}

