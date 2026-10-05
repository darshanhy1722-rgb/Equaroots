import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  attachment: { filename: string; content: Buffer };
}

function parseFrom(from: string) {
  const m = /^(.*)<(.+)>$/.exec(from.trim());
  return m ? { name: m[1].trim(), email: m[2].trim() } : { email: from.trim() };
}

/**
 * Sends via SendGrid when SENDGRID_API_KEY is set. Otherwise writes the email
 * to ./data/outbox (dev mode) so the full flow is testable without sending.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<{ provider: string; id?: string }> {
  if (!config.sendgridApiKey) {
    const dir = path.resolve('data/outbox');
    await fs.mkdir(dir, { recursive: true });
    const base = path.join(dir, `${Date.now()}-${msg.to.replace(/[^a-z0-9@.]/gi, '_')}`);
    await fs.writeFile(`${base}.json`, JSON.stringify({ to: msg.to, subject: msg.subject, html: msg.html }, null, 2));
    await fs.writeFile(`${base}-${msg.attachment.filename}`, msg.attachment.content);
    console.log(`[email] SENDGRID_API_KEY not set — wrote to ${base}.json`);
    return { provider: 'outbox' };
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.sendgridApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: parseFrom(config.emailFrom),
      subject: msg.subject,
      content: [{ type: 'text/html', value: msg.html }],
      attachments: [
        {
          content: msg.attachment.content.toString('base64'),
          filename: msg.attachment.filename,
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
  return { provider: 'sendgrid', id: res.headers.get('x-message-id') ?? undefined };
}
