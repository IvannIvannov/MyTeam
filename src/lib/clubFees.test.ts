import { beforeEach, expect, it, vi } from "vitest";
import { updateClubFees } from "@/lib/clubFees";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  club: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  coachGroup: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
  player: { findMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } }));
const groups = [{ id: "a", name: "A", paymentAmount: null }, { id: "b", name: "B", paymentAmount: null }];
const decimal = (value: string) => ({ toFixed: () => value });
const player = (overrides = {}) => ({ id: "p", fullName: "Player", paymentAmount: decimal("0.00"), billingCoachGroupId: null, coachGroups: groups, isActive: true, ...overrides });
beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([{ id: "club" }]);
  tx.club.findUniqueOrThrow.mockResolvedValue({ defaultPaymentAmount: decimal("85.00") });
  tx.coachGroup.findMany.mockResolvedValue(groups);
  tx.player.findMany.mockResolvedValue([player()]);
});
it("changes the club default without writing to personal fees", async () => {
  tx.player.findMany.mockResolvedValue([player({ paymentAmount: decimal("60.00") })]);
  const result = await updateClubFees("club", { paymentAmount: "90" });
  expect(tx.club.update).toHaveBeenCalledWith({ where: { id: "club" }, data: { defaultPaymentAmount: "90.00" } });
  expect(tx.player.update).not.toHaveBeenCalled();
  expect(result.players[0].effectiveAmount).toBe("60.00");
});
it("rejects fee differences before writing anything", async () => {
  await expect(updateClubFees("club", { groupFees: { a: "60" } })).rejects.toMatchObject({ status: 409, conflicts: [expect.objectContaining({ id: "p" })] });
  expect(tx.coachGroup.update).not.toHaveBeenCalled();
  expect(tx.player.update).not.toHaveBeenCalled();
});
it("saves a billing-group choice without turning it into a personal fee", async () => {
  await updateClubFees("club", { groupFees: { a: "60" }, billingChoices: { p: "a" } });
  expect(tx.player.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { billingCoachGroupId: "a" } });
});
it("rejects an assignment to a foreign group and an unrelated billing choice", async () => {
  await expect(updateClubFees("club", { assignments: { p: ["foreign"] } })).rejects.toMatchObject({ status: 400 });
  await expect(updateClubFees("club", { assignments: { p: ["a"] }, billingChoices: { p: "b" } })).rejects.toMatchObject({ status: 400 });
  expect(tx.player.update).not.toHaveBeenCalled();
});
it("requires resolving conflicts when removing a personal override", async () => {
  tx.coachGroup.findMany.mockResolvedValue([{ ...groups[0], paymentAmount: decimal("60.00") }, groups[1]]);
  tx.player.findMany.mockResolvedValue([player({ paymentAmount: decimal("45.00") })]);
  await expect(updateClubFees("club", { personalFees: { p: "0" } })).rejects.toMatchObject({ status: 409 });
  expect(tx.player.update).not.toHaveBeenCalled();
});
it("previews conflicts without writing", async () => {
  const result = await updateClubFees("club", { preview: true, groupFees: { a: "60" } });
  expect(result.conflicts).toHaveLength(1);
  expect(tx.coachGroup.update).not.toHaveBeenCalled();
});
it("rejects stale settings before overwriting another coach's changes", async () => {
  await expect(updateClubFees("club", { expectedRevision: "old", paymentAmount: "90" })).rejects.toMatchObject({ status: 409 });
  expect(tx.club.update).not.toHaveBeenCalled();
});
it("blocks deleting a selected billing group if the remaining groups conflict", async () => {
  const third = { id: "c", name: "C", paymentAmount: decimal("90.00") };
  tx.coachGroup.findMany.mockResolvedValue([...groups, third]);
  tx.player.findMany.mockResolvedValue([player({ coachGroups: [...groups, third], billingCoachGroupId: "a" })]);
  await expect(updateClubFees("club", { deleteGroupId: "a" })).rejects.toMatchObject({ status: 409 });
  expect(tx.coachGroup.delete).not.toHaveBeenCalled();
  await updateClubFees("club", { deleteGroupId: "a", billingChoices: { p: "c" } });
  expect(tx.coachGroup.delete).toHaveBeenCalledWith({ where: { id: "a" } });
  expect(tx.player.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { billingCoachGroupId: "c" } });
});
it("returns the saved revision so another assignment can be saved without reopening", async () => {
  const initial = await updateClubFees("club", { preview: true });
  const saved = await updateClubFees("club", { expectedRevision: initial.revision, billingChoices: { p: "a" } });
  expect(saved.revision).not.toBe(initial.revision);
  tx.player.findMany.mockResolvedValue([player({ billingCoachGroupId: "a" })]);
  await expect(updateClubFees("club", { expectedRevision: saved.revision, assignments: { p: ["a"] } })).resolves.toBeDefined();
});
