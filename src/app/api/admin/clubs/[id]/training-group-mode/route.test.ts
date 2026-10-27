import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), find: vi.fn(), update: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verify }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: mocks.lock, club: { findUnique: mocks.find, update: mocks.update } }) } }));
function request(mode: string) {
  return new NextRequest("http://localhost/api/admin/clubs/club/training-group-mode", {
    method: "PATCH", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify({ trainingGroupMode: mode }),
  });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.verify.mockResolvedValue({ roles: ["admin"] });
  mocks.find.mockResolvedValue({ playerFields: [] }); mocks.update.mockResolvedValue({ id: "club", trainingGroupMode: "custom_group" });
});
it("blocks cohort scheduling while Набор is hidden", async () => {
  const response = await PATCH(request("team_group"), { params: Promise.resolve({ id: "club" }) });
  expect(response.status).toBe(409); expect((await response.json()).error).toContain("Набор"); expect(mocks.update).not.toHaveBeenCalled();
});
it.each([[[], "custom_group"], [["teamGroup"], "team_group"]])("allows compatible settings %j / %s", async (playerFields, mode) => {
  mocks.find.mockResolvedValue({ playerFields });
  expect((await PATCH(request(mode as string), { params: Promise.resolve({ id: "club" }) })).status).toBe(200);
  expect(mocks.lock).toHaveBeenCalledOnce(); expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { trainingGroupMode: mode } }));
});
it("rejects coaches", async () => {
  mocks.verify.mockResolvedValue({ roles: ["coach"] });
  expect((await PATCH(request("team_group"), { params: Promise.resolve({ id: "club" }) })).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
