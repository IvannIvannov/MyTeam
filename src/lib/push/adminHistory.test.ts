import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClubAdminNotifications, getClubAdminUnreadCount, markClubAdminNotificationsRead } from "./adminHistory";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { adminNotification: mocks } }));
vi.mock("@/lib/adminNotificationEvents", () => ({ publishAdminNotificationCreated: vi.fn() }));

describe("coach main-page notification scope", () => {
  beforeEach(() => vi.clearAllMocks());
  it("excludes coach-page messages consistently from the list, count and read action", async () => {
    const input = { clubId: "club", excludeCoachPageMessages: true };
    await getClubAdminNotifications(input);
    await getClubAdminUnreadCount(input);
    await markClubAdminNotificationsRead(input);
    const excluded = { type: { in: ["admin_message", "myteam_message"] }, coachGroupId: { not: null } };
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: "club", NOT: excluded } }));
    for (const method of [mocks.count, mocks.updateMany]) {
      expect(method).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: "club", readAt: null, NOT: excluded } }));
    }
  });
  it("keeps admins' club-wide history", async () => {
    await getClubAdminNotifications({ clubId: "club", excludeCoachPageMessages: false });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: "club" } }));
  });
  it("keeps messages visible on the targeted coach page", async () => {
    const input = { clubId: "club", coachGroupId: "group", excludeCoachPageMessages: true };
    await getClubAdminNotifications(input);
    await getClubAdminUnreadCount(input);
    await markClubAdminNotificationsRead(input);
    for (const method of [mocks.findMany, mocks.count, mocks.updateMany]) {
      const where = method.mock.calls[0][0].where;
      expect(where.NOT).toBeUndefined();
      expect(where.OR).toContainEqual({ coachGroupId: "group" });
    }
  });
});
