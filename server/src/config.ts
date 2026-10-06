import 'dotenv/config';

function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://equaroots:equaroots@localhost:5432/equaroots',
  appBaseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-session-secret-change-me',
  googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  /** Optional Workspace domain restriction, e.g. "equaroots.com". Admins are always allowed. */
  googleAllowedDomain: (process.env.GOOGLE_ALLOWED_DOMAIN ?? '').toLowerCase(),
  adminEmails: list(process.env.ADMIN_EMAILS ?? 'darshan.hy1722@gmail.com,shweta.singh.533@gmail.com'),
  calWebhookSecret: process.env.CAL_WEBHOOK_SECRET ?? '',
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'EquaRoots <care@equaroots.com>',
  storage: {
    bucket: process.env.STORAGE_BUCKET ?? '',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.STORAGE_SECRET_KEY ?? '',
    endpoint: process.env.STORAGE_ENDPOINT ?? '', // e.g. https://<acct>.r2.cloudflarestorage.com
    region: process.env.STORAGE_REGION ?? 'auto',
    localDir: process.env.LOCAL_STORAGE_DIR ?? './data/pdfs',
  },
  /** Letterhead footer details. */
  clinic: {
    phone: process.env.CLINIC_PHONE ?? '+91 8796592169',
    email: process.env.CLINIC_EMAIL ?? 'hello@equaroots.com',
    entity: process.env.CLINIC_ENTITY ?? 'Dangaich Ventures LLP',
    social: process.env.CLINIC_SOCIAL ?? '@equaroots on IG | YT | LinkedIn',
    qrUrl: process.env.CLINIC_QR_URL ?? 'https://www.instagram.com/equaroots/',
  },
  chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROMIUM_PATH ?? '',
  /** Enables POST /api/auth/dev-login. Never set in production. */
  devLogin: process.env.AUTH_DEV_LOGIN === 'true',
  isProduction: process.env.NODE_ENV === 'production',
};

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && config.adminEmails.includes(email.trim().toLowerCase());
}
