import { describe, expect, it } from "vitest";
import { all, openDb } from "../src/db.js";
import { sendSms, smsStatus } from "../src/sms.js";
import { jsonResponse, testEnv } from "./helpers.js";

const twilio = { SMS_PROVIDER: "twilio", SMS_ACCOUNT_SID: "ACtest", SMS_AUTH_TOKEN: "tok", SMS_FROM_NUMBER: "+15550001111" };

describe("sms module (HTTP responses are test doubles for the provider)", () => {
  it("refuses with no provider configured and writes nothing", async () => {
    const db = openDb(":memory:");
    await expect(sendSms(db, testEnv(), "+15555550100", "hi")).rejects.toThrow(/not configured/);
    expect(all(db, "SELECT * FROM sms_log")).toHaveLength(0);
  });

  it("refuses an unsupported provider name", async () => {
    await expect(sendSms(openDb(":memory:"), testEnv({ ...twilio, SMS_PROVIDER: "other" }), "+1555", "x")).rejects.toThrow(/not configured/);
  });

  it("sends with HTTP basic auth and form-encoded body to the account's endpoint", async () => {
    let seen: { url: string; auth: string; body: string } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), auth: (init.headers as Record<string, string>).Authorization!, body: String(init.body) };
      return new Response(JSON.stringify({ sid: "SM1", status: "queued" }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await sendSms(openDb(":memory:"), testEnv(twilio), "+15555550100", "hello", f);
    expect(seen!.url).toContain("/Accounts/ACtest/Messages.json");
    expect(seen!.auth).toBe("Basic " + Buffer.from("ACtest:tok").toString("base64"));
    expect(seen!.body).toContain("To=%2B15555550100");
    expect(r.providerId).toBe("SM1");
  });

  it("surfaces provider rejection instead of reporting success, and logs nothing", async () => {
    const db = openDb(":memory:");
    await expect(sendSms(db, testEnv(twilio), "+15555550100", "x", jsonResponse({ message: "invalid number" }, 400))).rejects.toThrow(/invalid number/);
    expect(all(db, "SELECT * FROM sms_log")).toHaveLength(0);
  });

  it("only reports delivered when the provider says delivered", async () => {
    const env = testEnv(twilio);
    expect((await smsStatus(env, "SM1", jsonResponse({ status: "sent" }))).delivered).toBe(false);
    expect((await smsStatus(env, "SM1", jsonResponse({ status: "delivered" }))).delivered).toBe(true);
    const failed = await smsStatus(env, "SM1", jsonResponse({ status: "failed", error_code: 30003 }));
    expect(failed.delivered).toBe(false);
    expect(failed.errorCode).toBe(30003);
  });
});
