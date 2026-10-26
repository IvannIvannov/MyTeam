import { expect, it } from "vitest";
import { subscriptionAuditDescription } from "./clubSubscriptionAudit";
const entry = { id: "1", actorId: "account", createdAt: "2026-10-24", action: "fee", details: { oldAmount: "10.00", newAmount: "40.00", effectiveMonth: "2026-11" } };
it("explains the fee before and after, with its effective month", () => {
  expect(subscriptionAuditDescription(entry)).toBe("10.00 → 40.00 EUR / месец · В сила от 2026-11");
});
it("explains an unlimited trial becoming limited and tolerates older records", () => {
  expect(subscriptionAuditDescription({ ...entry, action: "trial", details: { before: null, after: "2026-11-01" } })).toBe("без крайна дата → до 01.11.2026");
  expect(subscriptionAuditDescription({ ...entry, action: "unknown", details: null })).toBe("Записана промяна на абонамента");
});
