import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIrisStoredCreatePayload,
  canReuseIrisPaymentLink,
  createIrisPayment,
  deactivateIrisPayment,
  getIrisPayRepayable,
  getIrisPaymentStatus,
  isReusableIrisCreatePayload,
} from "./irispay";

const originalEnv = { ...process.env };

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function getJsonBody(fetchMock: ReturnType<typeof vi.fn>) {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  return JSON.parse(String(body)) as Record<string, unknown>;
}

describe("IRISPay configuration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.IRISPAY_BASE_URL = "https://paybyclick.irispay.bg";
    process.env.IRISPAY_MERCHANT_KEY = "merchant/key with spaces";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("defaults repayable links to true", () => {
    delete process.env.IRISPAY_REPAYABLE;

    expect(getIrisPayRepayable()).toBe(true);
  });

  it("uses the reusable status endpoint with the Location key and preserves attempts", async () => {
    const payload = {
      paymentHash: "hash/1", status: "CONFIRMED",
      attempts: [
        { date: "2026-10-15T10:00:00Z", status: "FAILED", payerIban: null,
          payerBank: null, payerName: null, attemptPaymentHash: "attempt-1" },
        { date: "2026-10-15T10:01:00Z", status: "CONFIRMED", payerIban: "iban",
          payerBank: "bank", payerName: "payer", attemptPaymentHash: "attempt-2" },
      ],
    };
    const fetchMock = mockFetch(Response.json(payload));

    await expect(getIrisPaymentStatus("hash/1", true)).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://paybyclick.irispay.bg/backend/payment/status/repayable/hash%2F1",
      expect.objectContaining({ method: "GET", cache: "no-store",
        headers: { accept: "application/json", "X-Location-Key": "merchant/key with spaces" } }),
    );
  });

  it("keeps single-use status requests on the original endpoint without a Location key", async () => {
    delete process.env.IRISPAY_MERCHANT_KEY;
    const fetchMock = mockFetch(Response.json({ status: "WAITING" }));

    await expect(getIrisPaymentStatus("hash/1", false)).resolves.toEqual({ status: "WAITING" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://paybyclick.irispay.bg/backend/payment/status/hash%2F1",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("does not request reusable status without a configured Location key", async () => {
    delete process.env.IRISPAY_MERCHANT_KEY;
    const fetchMock = mockFetch(Response.json({}));
    await expect(getIrisPaymentStatus("hash-1", true)).rejects.toThrow("IRISPAY_MERCHANT_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows IRISPAY_REPAYABLE=false to restore non-repayable links", async () => {
    process.env.IRISPAY_REPAYABLE = "false";
    const fetchMock = mockFetch(Response.json({
      paymentHash: "hash-1",
      paymentLink: "https://paybyclick.irispay.bg/#/payment/link/hash-1",
    }));

    await createIrisPayment({
      amount: "20.00",
      description: "Monthly payment",
      hookUrl: "https://myteam7.com/api/irispay/webhook",
      name: "MyTeam",
      orderId: "order-1",
      redirectUrl: "https://myteam7.com/member/CARD",
    });

    expect(getJsonBody(fetchMock).repayable).toBe(false);
  });

  it("sends repayable true by default when creating a payment", async () => {
    delete process.env.IRISPAY_REPAYABLE;
    const fetchMock = mockFetch(Response.json({
      paymentHash: "hash-1",
      paymentLink: "https://paybyclick.irispay.bg/#/payment/link/hash-1",
    }));

    await createIrisPayment({
      amount: "20.00",
      description: "Monthly payment",
      hookUrl: "https://myteam7.com/api/irispay/webhook",
      name: "MyTeam",
      orderId: "order-1",
      redirectUrl: "https://myteam7.com/member/CARD",
    });

    expect(getJsonBody(fetchMock).repayable).toBe(true);
  });

  it("stores createOptions.repayable while preserving the IRIS response", () => {
    const stored = buildIrisStoredCreatePayload({
      accountId: "account-1",
      paymentHash: "hash-1",
      paymentLink: "https://paybyclick.irispay.bg/#/payment/link/hash-1",
      shortPaymentLink: "https://short.link/hash-1",
    }, true);

    expect(stored).toEqual({
      accountId: "account-1",
      paymentHash: "hash-1",
      paymentLink: "https://paybyclick.irispay.bg/#/payment/link/hash-1",
      shortPaymentLink: "https://short.link/hash-1",
      createOptions: { repayable: true },
    });
  });

  it("does not reuse legacy or non-repayable waiting links when reusable links are enabled", () => {
    expect(canReuseIrisPaymentLink(null, true)).toBe(false);
    expect(canReuseIrisPaymentLink({ paymentHash: "legacy" }, true)).toBe(false);
    expect(canReuseIrisPaymentLink({ createOptions: { repayable: false } }, true)).toBe(false);
  });

  it("reuses waiting links created with repayable true", () => {
    const rawCreatePayload = { paymentHash: "hash-1", createOptions: { repayable: true } };

    expect(isReusableIrisCreatePayload(rawCreatePayload)).toBe(true);
    expect(canReuseIrisPaymentLink(rawCreatePayload, true)).toBe(true);
  });

  it("retains non-repayable reuse behavior when IRISPAY_REPAYABLE=false", () => {
    expect(canReuseIrisPaymentLink({ paymentHash: "legacy" }, false)).toBe(true);
    expect(canReuseIrisPaymentLink({ createOptions: { repayable: false } }, false)).toBe(true);
  });

  it("calls the official deactivation endpoint with the encoded merchant key", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));

    await expect(deactivateIrisPayment("hash-1")).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://paybyclick.irispay.bg/backend/payment/inactive/merchant%2Fkey%20with%20spaces",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          accept: "application/json",
        }),
        body: JSON.stringify({ paymentHash: "hash-1" }),
        cache: "no-store",
      }),
    );
  });

  it("returns JSON deactivation responses when IRIS sends a body", async () => {
    mockFetch(Response.json({ success: true }));

    await expect(deactivateIrisPayment("hash-1")).resolves.toEqual({ success: true });
  });

  it("throws a safe deactivation error without exposing the merchant key", async () => {
    mockFetch(Response.json({ message: "Cannot deactivate this payment" }, { status: 400 }));

    let error: unknown;
    try {
      await deactivateIrisPayment("hash-1");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Cannot deactivate this payment");
    expect((error as Error).message).not.toContain("merchant/key");
  });

});
