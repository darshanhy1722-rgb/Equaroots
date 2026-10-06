import { pool, withTransaction, type Queryable } from '../db.js';
import { verifyCalSignature } from '../lib/signature.js';
import { mapCalPayload } from './calPayload.js';
import { listDoctors, matchDoctor } from './doctors.js';
import { assignPatientIdsAndFlags } from './patientIds.js';
import { getCalWebhookSecrets, secretHint } from './settings.js';

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

async function log(db: Queryable, ok: boolean, trigger: string | null, calUid: string | null, note: string, raw: unknown) {
  await db.query(
    'insert into webhook_logs(ok, trigger_event, cal_uid, note, raw_payload) values ($1,$2,$3,$4,$5)',
    [ok, trigger, calUid, note, raw === undefined ? null : JSON.stringify(raw)],
  );
}

function tryParse(raw: Buffer): any {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return { _unparseable: raw.toString('utf8').slice(0, 10000) };
  }
}

export async function handleCalWebhook(raw: Buffer, signature: string | undefined): Promise<WebhookResult> {
  const secrets = await getCalWebhookSecrets(pool);
  if (!secrets.some((s) => verifyCalSignature(raw, signature, s))) {
    const parsed = tryParse(raw);
    const note = !secrets.length
      ? 'rejected: CAL_WEBHOOK_SECRET is not set on the server'
      : !signature
        ? 'rejected: no X-Cal-Signature-256 header — the Secret field in this Cal.id webhook is empty'
        : `rejected: signature doesn't match — the Secret in this Cal.id webhook differs from the server's. ` +
          `Server accepts ${secrets.map(secretHint).join(', ')}; paste one of those exactly (or add this webhook's secret to CAL_WEBHOOK_SECRET, comma-separated).`;
    await log(pool, false, parsed?.triggerEvent ?? null, parsed?.payload?.uid ?? null, note, parsed);
    return { status: 401, body: { ok: false, error: 'invalid signature' } };
  }

  let body: any;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    await log(pool, false, null, null, 'rejected: body is not valid JSON', tryParse(raw));
    return { status: 400, body: { ok: false, error: 'invalid JSON' } };
  }

  const trigger: string = String(body?.triggerEvent ?? '');
  const m = mapCalPayload(body);

  try {
    if (trigger === 'BOOKING_CREATED' || trigger === 'BOOKING_RESCHEDULED') {
      if (!m.cal_uid) {
        await log(pool, false, trigger, null, 'rejected: payload has no booking uid', body);
        return { status: 400, body: { ok: false, error: 'missing booking uid' } };
      }
      const result = await withTransaction(async (c) => {
        const doctor = matchDoctor(await listDoctors(c), { email: m.doctor_email_raw, name: m.doctor_name_raw });

        // A reschedule arrives with a NEW uid; carry the old row forward so history/drafts stay attached.
        let existingId: number | null = null;
        const found = await c.query<{ id: number; status: string }>(
          'select id, status from bookings where cal_uid = any($1::text[]) order by (cal_uid = $2) desc limit 1',
          [[m.cal_uid, m.reschedule_from_uid].filter(Boolean), m.cal_uid],
        );
        existingId = found.rows[0]?.id ?? null;
        const keepStatus = found.rows[0]?.status === 'Prescription Sent';

        const values = [
          m.cal_uid, m.patient_name, m.age, m.gender, m.patient_email, m.patient_phone,
          doctor?.id ?? null, m.doctor_name_raw, m.doctor_email_raw, m.start_time, m.end_time,
          m.meet_link, m.description, m.status, JSON.stringify(body),
        ];
        let id: number;
        if (existingId) {
          await c.query(
            `update bookings set cal_uid=$1, patient_name=$2, age=coalesce($3, age), gender=coalesce($4, gender),
               patient_email=$5, patient_phone=coalesce($6, patient_phone), doctor_id=$7, doctor_name_raw=$8,
               doctor_email_raw=$9, start_time=$10, end_time=$11, meet_link=$12, description=$13,
               status=case when $16 then status else $14 end, raw_payload=$15, updated_at=now()
             where id=$17`,
            [...values, keepStatus, existingId],
          );
          id = existingId;
        } else {
          const ins = await c.query<{ id: number }>(
            `insert into bookings(cal_uid, patient_name, age, gender, patient_email, patient_phone, doctor_id,
               doctor_name_raw, doctor_email_raw, start_time, end_time, meet_link, description, status, raw_payload)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
            values,
          );
          id = ins.rows[0].id;
        }
        const assigned = await assignPatientIdsAndFlags(c);
        const note =
          `${existingId ? 'updated' : 'inserted'} booking #${id}` +
          (doctor ? ` → ${doctor.display_name}` : ` → NO DOCTOR MATCH for "${m.doctor_name_raw ?? ''}" <${m.doctor_email_raw ?? ''}>`) +
          (assigned.length ? `; assigned ${assigned.map((a) => `${a.patient_id}(${a.patient_type})`).join(', ')}` : '');
        await log(c, true, trigger, m.cal_uid, note, body);
        return { id, note };
      });
      return { status: 200, body: { ok: true, bookingId: result.id, note: result.note } };
    }

    if (trigger === 'BOOKING_CANCELLED') {
      const upd = await pool.query(
        `update bookings set status='CANCELLED', updated_at=now() where cal_uid = any($1::text[]) returning id`,
        [[m.cal_uid, m.reschedule_from_uid].filter(Boolean)],
      );
      const note = upd.rowCount ? `cancelled booking #${upd.rows[0].id}` : `cancel for unknown uid ${m.cal_uid}`;
      await log(pool, upd.rowCount! > 0, trigger, m.cal_uid, note, body);
      return { status: 200, body: { ok: true, note } };
    }

    await log(pool, true, trigger || null, m.cal_uid, `ignored trigger "${trigger}" (logged only)`, body);
    return { status: 200, body: { ok: true, ignored: trigger } };
  } catch (e: any) {
    await log(pool, false, trigger, m.cal_uid, `error: ${e?.message ?? e}`, body).catch(() => {});
    return { status: 500, body: { ok: false, error: 'processing failed' } };
  }
}
