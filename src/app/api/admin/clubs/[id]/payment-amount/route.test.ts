import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "./route";

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  findUnique: vi.fn(),
  clubUpdate: vi.fn(),
  playerUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verifyAdminToken }));
vi.mock("@/lib/db", () => ({
  prisma: {
    club: { findUnique: mocks.findUnique, update: mocks.clubUpdate },
    player: { updateMany: mocks.playerUpdateMany },
    $transaction: mocks.transaction,
  },
}));

function request() {
  return new NextRequest("http://localhost/api/admin/clubs/club-1/payment-amount", {
    method: "PATCH",
    headers: { cookie: "admin_session=test", "Content-Type": "application/json" },
    body: JSON.stringify({ paymentAmount: "21" }),
  });
}

describe("club monthly fee permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: "club-1" });
    mocks.transaction.mockResolvedValue([{ id: "club-1", defaultPaymentAmount: "21" }, { count: 3 }]);
  });

  it.each(["coach", "admin"])("lets a %s update the club and its players", async (role) => {
    mocks.verifyAdminToken.mockResolvedValue({ roles: [role] });
    const response = await PATCH(request(), { params: Promise.resolve({ id: "club-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.clubUpdate).toHaveBeenCalledWith({
      where: { id: "club-1" }, data: { defaultPaymentAmount: "21.00" },
    });
    expect(mocks.playerUpdateMany).toHaveBeenCalledWith({
      where: { clubId: "club-1" }, data: { paymentAmount: "21.00" },
    });
  });

  it("rejects other roles before updating data", async () => {
    mocks.verifyAdminToken.mockResolvedValue({ roles: ["member"] });
    const response = await PATCH(request(), { params: Promise.resolve({ id: "club-1" }) });
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid sessions before updating data", async () => {
    mocks.verifyAdminToken.mockResolvedValue(null);
    const response = await PATCH(request(), { params: Promise.resolve({ id: "club-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
