import { ReplitConnectors } from '@replit/connectors-sdk';

const connectors = new ReplitConnectors();

export interface ResendEmailPayload {
  to: string;
  subject: string;
  html: string;
  from: string;
}

/**
 * Send through the Replit-managed Resend connection.
 * The connector SDK supplies the authenticated Resend request; no API key
 * is read from application code or exposed to the client.
 */
export async function sendViaResend(payload: ResendEmailPayload): Promise<void> {
  const response = await connectors.proxy('resend', '/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Resend returned ${response.status}${details ? `: ${details}` : ''}`);
  }
}