import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), clubs: vi.fn(), history: vi.fn(), push: vi.fn(), template: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.session }));
vi.mock("@/lib/db", () => ({ prisma: { club: { findMany: mocks.clubs } } }));
vi.mock("@/lib/push/adminHistory", () => ({ saveAdminNotificationHistory: mocks.history }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: mocks.push }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: mocks.template }));

function request(includeCoachGroupPages = true) {
  return new NextRequest("http://localhost/api/admin/notifications/send-to-coaches", {
    method: "POST",
    headers: { cookie: "admin_session=test", "Content-Type": "application/json" },
    body: JSON.stringify({ clubIds: ["club"], message: "Hello", includeCoachGroupPages }),
  });
}

describe("admin broadcast sender", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ roles: ["admin", "coach"] });
    mocks.clubs.mockResolvedValue([{ id: "club", coachGroups: [{ id: "group" }] }]);
    mocks.push.mockResolvedValue({ total: 1, sent: 1, failed: 0, deactivated: 0 });
    mocks.template.mockImplementation(input => ({ title: "Съобщение от администратора", body: input.trainerMessage, url: input.url }));
  });

  it("marks both club and coach-page copies as MYTEAM7 messages", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    for (const coachGroupId of [null, "group"]) {
      expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({
        type: "myteam_message", coachGroupId,
        payload: expect.objectContaining({ body: "Hello" }),
      }));
    }
  });

  it("sends exactly one copy per scope with three coach groups", async () => {
    mocks.clubs.mockResolvedValue([{ id: "club", coachGroups: ["one", "two", "three"].map(id => ({ id })) }]);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.history).toHaveBeenCalledTimes(4);
    expect(mocks.push).toHaveBeenCalledTimes(4);
    for (const scope of [null, "one", "two", "three"]) {
      expect(mocks.history.mock.calls.filter(([input]) => input.coachGroupId === scope)).toHaveLength(1);
      expect(mocks.push.mock.calls.filter(([, , coachGroupId]) => coachGroupId === scope)).toHaveLength(1);
    }
  });

  it("sends only the main-page copy when coach pages are disabled", async () => {
    expect((await POST(request(false))).status).toBe(200);
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ coachGroupId: null }));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("club", expect.any(Object), null);
  });

  it("rejects a coach login before broadcasting", async () => {
    mocks.session.mockResolvedValue({ roles: ["coach"] });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
