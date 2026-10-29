import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/discounts/clubs/route";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  partnerDiscount: { findUnique: vi.fn() },
  club: { findMany: vi.fn() },
  teamDiscountConfig: { updateMany: vi.fn(), aggregate: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verify }));
const partnerId = "10000000-0000-4000-8000-000000000001";
const clubId = "10000000-0000-4000-8000-000000000002";
const request = (changes: unknown, cookie = "admin_session=token") => new NextRequest("http://localhost/api/admin/discounts/clubs", { method: "PATCH", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ partnerId, changes }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ roles: ["admin"] });
  mocks.partnerDiscount.findUnique.mockResolvedValue({ id: partnerId });
  mocks.club.findMany.mockResolvedValue([{ id: clubId }]);
  mocks.teamDiscountConfig.aggregate.mockResolvedValue({ _max: { order: 4 } });
  mocks.$transaction.mockImplementation(async callback => callback(mocks));
});

describe("partner club assignments", () => {
  it("requires an admin session", async () => {
    expect((await PATCH(request([], ""))).status).toBe(401);
    mocks.verify.mockResolvedValue({ roles: ["coach"] });
    expect((await PATCH(request([]))).status).toBe(403);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it("adds a club while preserving existing order and all other partners", async () => {
    expect((await PATCH(request([{ clubId, isVisible: true }]))).status).toBe(200);
    expect(mocks.teamDiscountConfig.updateMany).toHaveBeenCalledWith({ where: { clubId, discountId: partnerId }, data: { isVisible: true } });
    expect(mocks.teamDiscountConfig.upsert).toHaveBeenCalledWith({
      where: { clubId_teamGroup_discountId: { clubId, teamGroup: 0, discountId: partnerId } },
      update: { isVisible: true },
      create: { clubId, teamGroup: 0, discountId: partnerId, isVisible: true, order: 5 },
    });
  });
  it("removes visibility for every group of the selected club, without creating a config", async () => {
    expect((await PATCH(request([{ clubId, isVisible: false }]))).status).toBe(200);
    expect(mocks.teamDiscountConfig.updateMany).toHaveBeenCalledWith({ where: { clubId, discountId: partnerId }, data: { isVisible: false } });
    expect(mocks.teamDiscountConfig.upsert).not.toHaveBeenCalled();
  });
  it.each([[{ clubId, isVisible: "yes" }], [{ clubId: "invalid", isVisible: true }], [{ clubId, isVisible: true }, { clubId, isVisible: false }]])("rejects invalid or duplicate changes %j", async (...changes) => {
    expect((await PATCH(request(changes))).status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it("rejects deleted clubs before writing anything", async () => {
    mocks.club.findMany.mockResolvedValue([]);
    expect((await PATCH(request([{ clubId, isVisible: true }]))).status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it("returns a failed save when the transaction fails", async () => {
    mocks.$transaction.mockRejectedValue(new Error("transaction rolled back"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await PATCH(request([{ clubId, isVisible: true }]))).status).toBe(500);
    spy.mockRestore();
  });
});
