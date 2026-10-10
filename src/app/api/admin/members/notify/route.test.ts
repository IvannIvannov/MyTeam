import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  findMany: vi.fn(),
  buildNotificationPayload: vi.fn(),
  sendPushToMember: vi.fn(),
}));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verifyAdminToken }));
vi.mock("@/lib/db", () => ({
  prisma: { player: { findMany: mocks.findMany } },
  withPrismaPoolRetry: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: mocks.buildNotificationPayload }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: mocks.sendPushToMember }));

const clubId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const coachGroupId = "33333333-3333-4333-8333-333333333333";
function request(groupId?: string, message = "Hello") {
  return new NextRequest("http://localhost/api/admin/members/notify", {
    method: "POST",
    headers: { cookie: "admin_session=test", "Content-Type": "application/json" },
    body: JSON.stringify({ clubId, memberIds: [memberId], message, coachGroupId: groupId }),
  });
}

describe("member message permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdminToken.mockResolvedValue({ roles: ["coach"] });
    mocks.findMany.mockResolvedValue([{ id: memberId, fullName: "Player", cards: [{ cardCode: "ABC" }] }]);
    mocks.buildNotificationPayload.mockReturnValue({ title: "Message", body: "Hello" });
    mocks.sendPushToMember.mockResolvedValue({ sent: 1, failed: 0 });
  });

  it.each(["coach", "admin"])("allows a %s to message selected club members without a coach group", async role => {
    mocks.verifyAdminToken.mockResolvedValue({ roles: [role] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, targeted: 1, sent: 1, skipped: 0, failed: 0 });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ id: { in: [memberId] }, clubId, isActive: true });
    expect(mocks.sendPushToMember).toHaveBeenCalledWith(memberId, { title: "Message", body: "Hello" }, "trainer_message");
  });

  it("sends messages longer than 300 characters without truncating them", async () => {
    const message = "Съобщение ".repeat(100);
    const response = await POST(request(undefined, message));
    expect(response.status).toBe(200);
    expect(mocks.buildNotificationPayload).toHaveBeenCalledWith(expect.objectContaining({
      trainerMessage: message.trim(),
    }));
    expect(mocks.sendPushToMember).toHaveBeenCalledOnce();
  });

  it.each(["", "   "])("rejects empty messages %j", async message => {
    expect((await POST(request(undefined, message))).status).toBe(400);
    expect(mocks.sendPushToMember).not.toHaveBeenCalled();
  });

  it("preserves the coach-group filter when provided", async () => {
    expect((await POST(request(coachGroupId))).status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [memberId] }, clubId, isActive: true, coachGroups: { some: { id: coachGroupId } },
    });
  });

  it("does not send to members excluded by the database scope", async () => {
    mocks.findMany.mockResolvedValue([]);
    const response = await POST(request());
    expect(await response.json()).toEqual({ success: true, targeted: 1, sent: 0, skipped: 1, failed: 0 });
    expect(mocks.sendPushToMember).not.toHaveBeenCalled();
  });

  it.each([[null, 401], [{ roles: ["member"] }, 403]])("rejects unauthorized sessions %j", async (session, status) => {
    mocks.verifyAdminToken.mockResolvedValue(session);
    expect((await POST(request())).status).toBe(status);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.sendPushToMember).not.toHaveBeenCalled();
  });

  it("rejects malformed coach-group IDs", async () => {
    expect((await POST(request("invalid"))).status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
