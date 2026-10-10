import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), groups: vi.fn(), history: vi.fn(), push: vi.fn(), template: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.session }));
vi.mock("@/lib/db", () => ({ prisma: { coachGroup: { findMany: mocks.groups } } }));
vi.mock("@/lib/push/adminHistory", () => ({ saveAdminNotificationHistory: mocks.history }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: mocks.push }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: mocks.template }));

const clubId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/members/notify-coaches", {
    method: "POST", headers: { cookie: "admin_session=test", "Content-Type": "application/json" },
    body: JSON.stringify({ clubId, coachGroupIds: [groupId], message: "Hello", ...overrides }),
  });
}
describe("coach page messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ roles: ["coach"] });
    mocks.groups.mockResolvedValue([{ id: groupId }]);
    mocks.history.mockResolvedValue({});
    mocks.push.mockResolvedValue({ sent: 1, failed: 0 });
    mocks.template.mockImplementation(input => ({ title: "Message", body: input.trainerMessage, url: input.url }));
  });
  it.each(["admin", "coach"])("lets %s target only the selected coach page", async role => {
    mocks.session.mockResolvedValue({ roles: [role] });
    const response = await POST(request());
    expect(await response.json()).toEqual({ success: true, delivered: 1, sent: 1, failed: 0, pushFailed: 0 });
    expect(mocks.groups).toHaveBeenCalledWith({ where: { clubId, id: { in: [groupId] } }, select: { id: true } });
    expect(mocks.history).toHaveBeenCalledWith({ clubId, coachGroupId: groupId, type: role === "admin" ? "myteam_message" : "admin_message", payload: {
      title: "Съобщение до треньори", body: "Hello", url: `/admin/members?clubId=${clubId}&coachGroupId=${groupId}`,
    } });
    expect(mocks.push).toHaveBeenCalledWith(clubId, expect.any(Object), groupId);
  });
  it("records history without push subscribers", async () => {
    mocks.push.mockResolvedValue({ sent: 0, failed: 0 });
    expect(await (await POST(request())).json()).toMatchObject({ delivered: 1, sent: 0 });
    expect(mocks.history).toHaveBeenCalledOnce();
  });
  it("marks the admin login with both roles as a MYTEAM7 message", async () => {
    mocks.session.mockResolvedValue({ roles: ["admin", "coach"] });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ type: "myteam_message" }));
  });
  it("preserves the page message when push throws", async () => {
    mocks.push.mockRejectedValue(new Error("push unavailable"));
    expect(await (await POST(request())).json()).toMatchObject({ success: true, delivered: 1, pushFailed: 1 });
    expect(mocks.history).toHaveBeenCalledOnce();
  });
  it("does not push when history fails", async () => {
    mocks.history.mockRejectedValue(new Error("database unavailable"));
    expect(await (await POST(request())).json()).toMatchObject({ success: false, delivered: 0, failed: 1 });
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("rejects groups outside the selected club before delivery", async () => {
    mocks.groups.mockResolvedValue([]);
    expect((await POST(request())).status).toBe(400);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("deduplicates recipients", async () => {
    await POST(request({ coachGroupIds: [groupId, groupId] }));
    expect(mocks.history).toHaveBeenCalledOnce();
  });
  it("delivers to every selected coach page", async () => {
    const otherId = "33333333-3333-4333-8333-333333333333";
    mocks.groups.mockResolvedValue([{ id: groupId }, { id: otherId }]);
    const response = await POST(request({ coachGroupIds: [groupId, otherId] }));
    expect(await response.json()).toMatchObject({ delivered: 2, sent: 2 });
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ coachGroupId: groupId }));
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ coachGroupId: otherId }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith(clubId, expect.any(Object), otherId);
  });
  it("stores and sends messages longer than 300 characters without truncating them", async () => {
    const message = "Съобщение ".repeat(100);
    const response = await POST(request({ message }));
    expect(response.status).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ body: message.trim() }),
    }));
    expect(mocks.push).toHaveBeenCalledWith(clubId, expect.objectContaining({ body: message.trim() }), groupId);
  });
  it.each([{ coachGroupIds: [] }, { coachGroupIds: ["invalid"] }, { clubId: "invalid" }, { message: " " }, { message: "" }, { message: 123 }])("rejects invalid input %j", async input => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mocks.groups).not.toHaveBeenCalled();
  });
  it.each([[null, 401], [{ roles: ["member"] }, 403]])("rejects unauthorized sessions %j", async (session, status) => {
    mocks.session.mockResolvedValue(session);
    expect((await POST(request())).status).toBe(status);
    expect(mocks.groups).not.toHaveBeenCalled();
  });
});
