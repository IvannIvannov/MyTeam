import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
const mocks = vi.hoisted(() => ({ verifyAdminToken: vi.fn(), updateClubFees: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verifyAdminToken }));
vi.mock("@/lib/clubFees", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/clubFees")>(), updateClubFees: mocks.updateClubFees }));
function request() {
  return new NextRequest("http://localhost/api/admin/clubs/club-1/payment-amount", {
    method: "PATCH", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify({ paymentAmount: "21" }),
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.updateClubFees.mockResolvedValue({ paymentAmount: "21.00" }); });
it.each(["coach", "admin"])("allows a %s to edit fee settings", async (role) => {
  mocks.verifyAdminToken.mockResolvedValue({ roles: [role] });
  expect((await PATCH(request(), { params: Promise.resolve({ id: "club-1" }) })).status).toBe(200);
  expect(mocks.updateClubFees).toHaveBeenCalledWith("club-1", { paymentAmount: "21" });
});
it.each([[{ roles: ["member"] }, 403], [null, 401]])("rejects unauthorized access", async (session, status) => {
  mocks.verifyAdminToken.mockResolvedValue(session);
  expect((await PATCH(request(), { params: Promise.resolve({ id: "club-1" }) })).status).toBe(status);
  expect(mocks.updateClubFees).not.toHaveBeenCalled();
});
