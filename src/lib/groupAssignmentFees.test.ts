import { expect, it } from "vitest";
import { previewGroupAssignmentFees, rebaseGroupAssignmentSelection, type GroupFeeSettings } from "@/lib/groupAssignmentFees";

const settings: GroupFeeSettings = {
  paymentAmount: "85.00", revision: "v1",
  groups: [{ id: "a", name: "A", paymentAmount: "60.00" }, { id: "b", name: "B", paymentAmount: "80.00" }],
  players: [{ id: "p", fullName: "Player", paymentAmount: "0.00", billingCoachGroupId: null, coachGroupIds: ["a"], isActive: true, teamGroup: 2015 }],
};
it("shows a fee conflict immediately upon selection, before any save", () => {
  expect(previewGroupAssignmentFees(settings, "b", new Set(), {})).toEqual([]);
  const [row] = previewGroupAssignmentFees(settings, "b", new Set(["p"]), {});
  expect(row.fee.source).toBe("conflict");
  expect(row.groups.map((g) => g.id)).toEqual(["a", "b"]);
  expect(settings.players[0].coachGroupIds).toEqual(["a"]);
});
it("resolves choices locally and drops a deselected assignment", () => {
  const [row] = previewGroupAssignmentFees(settings, "b", new Set(["p"]), { p: "b" });
  expect(row.fee.amount).toBe("80.00");
  expect(row.billingCoachGroupId).toBe("b");
  expect(previewGroupAssignmentFees(settings, "b", new Set(), { p: "b" })).toEqual([]);
});
it("keeps a personal fee despite joining differently priced groups", () => {
  const personal = { ...settings, players: [{ ...settings.players[0], paymentAmount: "45.00" }] };
  expect(previewGroupAssignmentFees(personal, "b", new Set(["p"]), {})[0].fee).toEqual({ amount: "45.00", source: "personal" });
});
it("does not require a choice for equal effective group fees", () => {
  const equal = { ...settings, groups: settings.groups.map((g) => ({ ...g, paymentAmount: null })) };
  expect(previewGroupAssignmentFees(equal, "b", new Set(["p"]), {})[0].fee.amount).toBe("85.00");
});
it("requires a new choice when removing the selected billing group leaves differing groups", () => {
  const three = { ...settings, groups: [...settings.groups, { id: "c", name: "C", paymentAmount: "90.00" }],
    players: [{ ...settings.players[0], coachGroupIds: ["a", "b", "c"], billingCoachGroupId: "a" }] };
  const [row] = previewGroupAssignmentFees(three, "a", new Set(), {});
  expect(row.billingCoachGroupId).toBeNull();
  expect(row.fee.source).toBe("conflict");
});
it("refreshes stale fees without undoing someone else's unrelated membership additions", () => {
  const refreshed = { ...settings, players: [...settings.players, { ...settings.players[0], id: "other", coachGroupIds: ["b"] }] };
  const selected = rebaseGroupAssignmentSelection(refreshed, "b", { p: ["a", "b"] });
  expect([...selected].sort()).toEqual(["other", "p"]);
  expect(previewGroupAssignmentFees(refreshed, "b", selected, {}).map((p) => p.id)).toEqual(["p"]);
});
