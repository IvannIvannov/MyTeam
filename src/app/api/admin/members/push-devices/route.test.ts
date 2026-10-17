import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verify }));
vi.mock("@/lib/db", () => ({
  prisma: { player: { findMany: mocks.findMany } },
  withPrismaPoolRetry: (operation: () => Promise<unknown>) => operation(),
}));
const clubId = "11111111-1111-4111-8111-111111111111";
function request(query = `clubId=${clubId}`) {
  return new NextRequest(`http://localhost/api/admin/members/push-devices?${query}`, {
    headers: { cookie: "admin_session=test" },
  });
}

describe("club player active device counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ roles: ["admin"] });
    mocks.findMany.mockResolvedValue([]);
  });

  it.each([[null, 401], [{ roles: [] }, 403]])("rejects unauthorized access %j", async (session, status) => {
    mocks.verify.mockResolvedValue(session);
    expect((await GET(request())).status).toBe(status);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects a missing session cookie", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/admin/members/push-devices?clubId=${clubId}`));
    expect(response.status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it.each(["", "clubId=invalid"])("requires a valid explicit club: %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it.each(["admin", "coach"])("allows %s to retrieve club-wide counts, including zero, regardless of page group filters", async (role) => {
    mocks.verify.mockResolvedValue({ roles: [role] });
    mocks.findMany.mockResolvedValue([
      { id: "one", fullName: "Иван Иванов", _count: { pushSubscriptions: 3 } },
      { id: "two", fullName: "Петър Петров", _count: { pushSubscriptions: 0 } },
    ]);
    const response = await GET(request(`clubId=${clubId}&coachGroupId=other`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ players: [
      { id: "one", fullName: "Иван Иванов", activeDeviceCount: 3 },
      { id: "two", fullName: "Петър Петров", activeDeviceCount: 0 },
    ] });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { clubId, isActive: true },
      select: { id: true, fullName: true, _count: { select: { pushSubscriptions: { where: { isActive: true } } } } },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    });
  });

  it("returns an empty list for a club without active players", async () => {
    expect(await (await GET(request())).json()).toEqual({ players: [] });
  });
});
