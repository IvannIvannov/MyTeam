import { expect, it } from "vitest";
import { resolveManualPaymentAmount } from "./manualPaymentAmounts";

it("prefers the personal fee over the club fee", () => {
  expect(resolveManualPaymentAmount("25.50", "40.00")).toBe("25.50");
});

it("uses the club fee when the personal fee is unset or zero", () => {
  for (const personal of [null, undefined, "", "0.00"]) {
    expect(resolveManualPaymentAmount(personal, "40.00")).toBe("40.00");
  }
  expect(resolveManualPaymentAmount("0", "0")).toBe("0.00");
});

it("does not invent a fee when neither amount is configured", () => {
  expect(resolveManualPaymentAmount(null, undefined)).toBeNull();
});
