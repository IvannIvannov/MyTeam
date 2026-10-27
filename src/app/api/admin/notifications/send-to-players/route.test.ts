import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), count: vi.fn(), players: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.session }));
vi.mock("@/lib/db", () => ({ prisma: { club: { count: mocks.count }, player: { findMany: mocks.players } } }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: mocks.push }));

const clubA = "11111111-1111-1111-1111-111111111111";
const clubB = "22222222-2222-2222-2222-222222222222";
function request(body: unknown, authenticated = true) {
  return new NextRequest("http://localhost/api/admin/notifications/send-to-players", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { cookie: "admin_session=test" } : {}) },
    body: JSON.stringify(body),
  });
}

describe("player notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ roles: ["admin"] });
    mocks.count.mockResolvedValue(1);
    mocks.players.mockResolvedValue([{ id: "player-a", cards: [{ cardCode: "card-a" }] }, { id: "player-b", cards: [] }]);
    mocks.push.mockResolvedValue({ total: 1, sent: 1, failed: 0, deactivated: 0 });
  });

  it("rejects unauthenticated requests and coaches before querying recipients", async () => {
    expect((await POST(request({}, false))).status).toBe(401);
    mocks.session.mockResolvedValue({ roles: ["coach"] });
    expect((await POST(request({ audience: "all", message: "Hello" }))).status).toBe(403);
    expect(mocks.players).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([[clubA], [clubA, clubB], [clubA, clubA]])("filters players by selected clubs %j", async (...ids) => {
    const clubIds = ids as string[];
    mocks.count.mockResolvedValue(new Set(clubIds).size);
    expect((await POST(request({ audience: "clubs", clubIds, message: "Hello" }))).status).toBe(200);
    expect(mocks.players).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: { in: [...new Set(clubIds)] } } }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it("targets all players regardless of push subscriptions and uses their own card links", async () => {
    mocks.push.mockResolvedValue({ total: 0, sent: 0, failed: 0, deactivated: 0 });
    const response = await POST(request({ audience: "all", clubIds: [clubA], message: " Hello " }));
    expect(mocks.players).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("player-a", expect.objectContaining({ title: "Съобщение от администратора на MyTeam", body: "Hello", url: "/member/card-a", data: { type: "myteam_message" } }), "myteam_message");
    expect(mocks.push).toHaveBeenCalledWith("player-b", expect.objectContaining({ url: "/" }), "myteam_message");
    expect(await response.json()).toMatchObject({ targetedPlayers: 2, failedPlayers: 0, summary: { total: 0, sent: 0 } });
  });

  it.each([null, [], {}, { audience: "all", message: " " }, { audience: "all", message: "a".repeat(1001) },
    { audience: "clubs", message: "Hello", clubIds: [] }, { audience: "clubs", message: "Hello", clubIds: [clubA, 5] },
    { audience: "clubs", message: "Hello", clubIds: ["invalid"] }, { message: "Hello" }])("rejects invalid input %j", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.players).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("rejects unknown clubs without sending to a partial selection", async () => {
    mocks.count.mockResolvedValue(1);
    expect((await POST(request({ audience: "clubs", clubIds: [clubA, clubB], message: "Hello" }))).status).toBe(400);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("reports an empty audience", async () => {
    mocks.players.mockResolvedValue([]);
    expect((await POST(request({ audience: "all", message: "Hello" }))).status).toBe(404);
  });

  it("continues delivering after a player fails and reports device failures separately", async () => {
    mocks.push.mockRejectedValueOnce(new Error("Delivery failed"));
    mocks.push.mockResolvedValueOnce({ total: 2, sent: 1, failed: 1, deactivated: 1 });
    const response = await POST(request({ audience: "all", message: "Hello" }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ targetedPlayers: 2, failedPlayers: 1, summary: { total: 2, sent: 1, failed: 1, deactivated: 1 } });
  });
});
