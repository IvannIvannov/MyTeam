import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export function coveredMonths(payment) {
  const start = new Date(payment.paidFor);
  const end = new Date(payment.paidThrough ?? payment.paidFor);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new Error("Invalid covered period");
  }
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function buildReport(payments, logs, checks) {
  const confirmedByMonth = new Map();
  for (const payment of payments) {
    if (checks.get(payment.id)?.status !== "CONFIRMED") continue;
    for (const month of coveredMonths(payment)) {
      const key = `${payment.playerId}/${month}`;
      const hashes = confirmedByMonth.get(key) ?? [];
      hashes.push(payment.paymentHash);
      confirmedByMonth.set(key, hashes);
    }
  }
  const records = payments.map((payment) => {
    const check = checks.get(payment.id) ?? { error: "Not checked" };
    const months = coveredMonths(payment).map((month) => ({
      month,
      existingLogs: logs.filter((log) => log.playerId === payment.playerId &&
        new Date(log.paidFor).toISOString().slice(0, 7) === month)
        .map((log) => ({ id: log.id, recordedBy: log.recordedBy, paidAt: log.paidAt,
          amount: log.amount?.toString() ?? null, currency: log.currency })),
      otherConfirmedLinks: (confirmedByMonth.get(`${payment.playerId}/${month}`) ?? [])
        .filter((hash) => hash !== payment.paymentHash),
    }));
    const recorded = months.filter((month) => month.existingLogs.length > 0).length;
    const coverage = recorded === 0 ? "NONE_RECORDED" :
      recorded === months.length ? "ALL_RECORDED" : "PARTIALLY_RECORDED";
    const flags = [];
    if (payment.trainingCredits != null) flags.push("TRAINING_CREDITS_REVIEW");
    if (months.some((month) => month.otherConfirmedLinks.length)) flags.push("OVERLAPPING_CONFIRMED_LINKS");
    if ((check.confirmedAttempts ?? 0) > 1) flags.push("MULTIPLE_CONFIRMED_ATTEMPTS");
    if (months.some((month) => month.existingLogs.length > 1)) flags.push("MULTIPLE_LOGS_FOR_MONTH");
    if (check.status === "CONFIRMED" && check.repayable && !check.confirmedAttempts) {
      flags.push("CONFIRMED_WITHOUT_CONFIRMED_ATTEMPT");
    }
    if (check.identityMismatch) flags.push("IRIS_IDENTITY_MISMATCH");
    if (check.amountMismatch) flags.push("IRIS_AMOUNT_OR_CURRENCY_MISMATCH");
    if (!check.creationModeKnown) flags.push("UNKNOWN_CREATION_MODE");
    if (payment.paymentLogId) flags.push("ALREADY_LINKED_TO_PAYMENT_LOG");
    return {
      paymentHash: payment.paymentHash, orderId: payment.orderId, playerId: payment.playerId,
      localStatus: payment.status, amount: payment.amount.toString(), currency: payment.currency,
      paidFor: payment.paidFor, paidThrough: payment.paidThrough,
      apiStatus: check.status ?? null, error: check.error ?? null,
      confirmedAttempts: check.confirmedAttempts ?? 0, attempts: check.attempts ?? [],
      coverage, flags, months,
    };
  });
  return {
    summary: {
      checkedLinks: records.length,
      errors: records.filter((record) => record.error).length,
      confirmed: records.filter((record) => record.apiStatus === "CONFIRMED").length,
      confirmedCoverage: Object.fromEntries(["NONE_RECORDED", "PARTIALLY_RECORDED", "ALL_RECORDED"]
        .map((coverage) => [coverage, records.filter((record) =>
          record.apiStatus === "CONFIRMED" && record.coverage === coverage).length])),
    },
    // Includes non-confirmed links so failed requests and unresolved statuses remain visible.
    payments: records,
  };
}

async function main() {
  dotenv.config({ quiet: true });
  const base = process.env.IRISPAY_BASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.IRISPAY_MERCHANT_KEY?.trim();
  if (!base || !key) throw new Error("IRISPAY_BASE_URL and IRISPAY_MERCHANT_KEY must be configured");
  if (!["https://paybyclick.irispay.bg", "https://dev.paybyclick.irispay.bg"].includes(base)) {
    throw new Error("Expected an official IRIS development or production URL");
  }
  const db = new PrismaClient();
  try {
    // Include already-confirmed links to detect overlaps with unresolved payments.
    const payments = await db.irisPayment.findMany({
      where: { paymentHash: { not: null } }, orderBy: { createdAt: "asc" },
      select: { id: true, playerId: true, paymentHash: true, orderId: true, status: true,
        amount: true, currency: true, paidFor: true, paidThrough: true, trainingCredits: true,
        paymentLogId: true, rawCreatePayload: true },
    });
    const playerIds = [...new Set(payments.map((payment) => payment.playerId))];
    const checks = new Map();
    console.error(`Checking ${payments.length} links against ${base}; read-only.`);
    for (const [index, payment] of payments.entries()) {
      const mode = payment.rawCreatePayload?.createOptions?.repayable;
      const repayable = mode === true;
      const check = { repayable, creationModeKnown: typeof mode === "boolean" };
      try {
        const response = await fetch(`${base}/backend/payment/status/${repayable ? "repayable/" : ""}${encodeURIComponent(payment.paymentHash)}`, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(30000),
          headers: { accept: "application/json", ...(repayable ? { "X-Location-Key": key } : {}) },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!["WAITING", "FAILED", "CONFIRMED"].includes(payload.status)) {
          throw new Error("Unknown IRIS status");
        }
        check.status = payload.status;
        // Omit payer names, IBANs, descriptions and all credentials from the report.
        check.attempts = (Array.isArray(payload.attempts) ? payload.attempts : [])
          .map((attempt) => ({ hash: attempt.attemptPaymentHash, status: attempt.status, date: attempt.date }));
        check.confirmedAttempts = check.attempts.filter((attempt) => attempt.status === "CONFIRMED").length;
        check.identityMismatch = Boolean((payload.paymentHash && payload.paymentHash !== payment.paymentHash) ||
          (payload.orderId && payload.orderId !== payment.orderId));
        check.amountMismatch = payload.sum == null || !Number.isFinite(Number(payload.sum)) ||
          Math.round(Number(payload.sum) * 100) !== Math.round(Number(payment.amount.toString()) * 100) ||
          payload.currency !== payment.currency;
      } catch (error) {
        check.error = /^HTTP \d+$/.test(error.message) || error.message === "Unknown IRIS status"
          ? error.message : "Request failed or returned invalid JSON";
      }
      checks.set(payment.id, check);
      console.error(`${index + 1}/${payments.length}: ${check.status ?? check.error}`);
    }
    // Fetch logs after API checks, so the report uses the latest available payment records.
    const logs = playerIds.length ? await db.paymentLog.findMany({
      where: { playerId: { in: playerIds } },
      select: { id: true, playerId: true, paidFor: true, paidAt: true,
        recordedBy: true, amount: true, currency: true },
    }) : [];
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), environment: base,
      readOnly: true, ...buildReport(payments, logs, checks) }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Report failed. Verify database connectivity, schema and IRIS configuration. No updates were performed.");
    process.exitCode = 1;
  });
}
