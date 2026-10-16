import { describe, expect, it } from "vitest";
import { resolveMemberFee } from "@/lib/memberFee";

const groups = [{ id: "a", name: "A", paymentAmount: "60" }, { id: "b", name: "B", paymentAmount: "80" }];
describe("member fee priority", () => {
  it("preserves personal fees despite conflicting groups", () => {
    expect(resolveMemberFee({ paymentAmount: "45", coachGroups: groups }, "85")).toEqual({ amount: "45.00", source: "personal" });
  });
  it("requires a choice for differing fees and follows that group's future price", () => {
    expect(resolveMemberFee({ paymentAmount: 0, coachGroups: groups }, "85").source).toBe("conflict");
    expect(resolveMemberFee({ paymentAmount: 0, billingCoachGroupId: "a", coachGroups: groups }, "85").amount).toBe("60.00");
    expect(resolveMemberFee({ paymentAmount: 0, billingCoachGroupId: "a", coachGroups: [{ ...groups[0], paymentAmount: "65" }, groups[1]] }, "85").amount).toBe("65.00");
  });
  it("ignores a selected group outside current membership", () => {
    expect(resolveMemberFee({ paymentAmount: 0, billingCoachGroupId: "removed", coachGroups: groups }, "85").source).toBe("conflict");
  });
  it("uses common effective prices and club fallback without storing a personal fee", () => {
    expect(resolveMemberFee({ paymentAmount: 0, coachGroups: [{ ...groups[0], paymentAmount: null }, { ...groups[1], paymentAmount: "85" }] }, "85").amount).toBe("85.00");
    expect(resolveMemberFee({ paymentAmount: 0 }, "85")).toEqual({ amount: "85.00", source: "club" });
    expect(resolveMemberFee({ paymentAmount: 0, coachGroups: [{ ...groups[0], paymentAmount: "0" }] }, "85").amount).toBe("0.00");
  });
});
