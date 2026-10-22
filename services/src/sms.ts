import type { Env } from "./config.js";
import { run, type Db } from "./db.js";

/**
 * Real SMS via the Twilio REST API. Without credentials this throws; it never pretends to send.
 * The provider's own status ("queued", "sent", "delivered", "failed") is stored and returned as-is.
 * A "queued"/"accepted" status is NOT delivery; use smsStatus() to read the provider's later status.
 */
function creds(env: Env) {
  if (env.SMS_PROVIDER.toLowerCase() !== "twilio") {
    throw new Error("SMS not configured: set SMS_PROVIDER=twilio, SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, SMS_FROM_NUMBER");
  }
  if (!env.SMS_ACCOUNT_SID || !env.SMS_AUTH_TOKEN || !env.SMS_FROM_NUMBER) {
    throw new Error("SMS not configured: SMS_ACCOUNT_SID, SMS_AUTH_TOKEN and SMS_FROM_NUMBER are required");
  }
  const auth = "Basic " + Buffer.from(`${env.SMS_ACCOUNT_SID}:${env.SMS_AUTH_TOKEN}`).toString("base64");
  return { auth, base: `https://api.twilio.com/2010-04-01/Accounts/${env.SMS_ACCOUNT_SID}` };
}

export async function sendSms(db: Db, env: Env, to: string, body: string, fetcher: typeof fetch = fetch) {
  const { auth, base } = creds(env);
  const res = await fetcher(`${base}/Messages.json`, {
    method: "POST",
    headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: env.SMS_FROM_NUMBER, Body: body }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json()) as { sid?: string; status?: string; message?: string };
  if (!res.ok || !j.sid) throw new Error(`SMS provider rejected the request: ${j.message ?? res.status}`);
  run(db, "INSERT INTO sms_log (to_number, provider_id, provider_status, created_at) VALUES (?, ?, ?, ?)", to, j.sid, j.status ?? "unknown", Math.floor(Date.now() / 1000));
  return { providerId: j.sid, providerStatus: j.status ?? "unknown", delivered: j.status === "delivered" };
}

export async function smsStatus(env: Env, sid: string, fetcher: typeof fetch = fetch) {
  const { auth, base } = creds(env);
  const res = await fetcher(`${base}/Messages/${sid}.json`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(20_000) });
  const j = (await res.json()) as { status?: string; error_code?: number | null; message?: string };
  if (!res.ok) throw new Error(`SMS provider error: ${j.message ?? res.status}`);
  return { providerId: sid, providerStatus: j.status ?? "unknown", errorCode: j.error_code ?? null, delivered: j.status === "delivered" };
}
