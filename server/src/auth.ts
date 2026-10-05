import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config, isAdminEmail } from './config.js';
import { pool } from './db.js';
import type { Doctor } from './services/doctors.js';

export const SESSION_COOKIE = 'er_session';
const SESSION_TTL_S = 12 * 60 * 60;

export interface Viewer {
  email: string;
  isAdmin: boolean;
  /** First doctor row for this email (null for a pure admin). */
  doctor: Doctor | null;
  /** All doctor rows sharing this login email (a shared mailbox can host several doctors). */
  doctors: Doctor[];
  authorized: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      viewer?: Viewer;
    }
  }
}

export function issueSession(res: Response, email: string) {
  const token = jwt.sign({ email: email.toLowerCase() }, config.sessionSecret, { expiresIn: SESSION_TTL_S });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: SESSION_TTL_S * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

const googleClient = new OAuth2Client(config.googleClientId || undefined);

/** Verifies a Google Identity Services ID token and returns the verified email. */
export async function verifyGoogleCredential(credential: string): Promise<string> {
  if (!config.googleClientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new Error('Google account email is not verified');
  const email = p.email.toLowerCase();
  if (config.googleAllowedDomain && !isAdminEmail(email) && p.hd !== config.googleAllowedDomain) {
    throw new Error(`Only @${config.googleAllowedDomain} accounts may sign in`);
  }
  return email;
}

export async function loadViewer(email: string): Promise<Viewer> {
  const { rows } = await pool.query<Doctor>(
    'select id, display_name, role, reg_no, signature_url, email from doctors where lower(email)=lower($1) order by id',
    [email],
  );
  const isAdmin = isAdminEmail(email);
  return { email, isAdmin, doctor: rows[0] ?? null, doctors: rows, authorized: isAdmin || rows.length > 0 };
}

/** Requires a valid session cookie; attaches req.viewer. */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ ok: false, error: 'not signed in' });
  try {
    const { email } = jwt.verify(token, config.sessionSecret) as { email: string };
    req.viewer = await loadViewer(email);
    next();
  } catch {
    clearSession(res);
    return res.status(401).json({ ok: false, error: 'session expired' });
  }
}

/** Requires the viewer to be a known doctor or an admin. */
export function requireAuthorized(req: Request, res: Response, next: NextFunction) {
  if (!req.viewer?.authorized) {
    return res.status(403).json({ ok: false, error: 'not set up as a doctor', email: req.viewer?.email });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.viewer?.isAdmin) return res.status(403).json({ ok: false, error: 'admin only' });
  next();
}
