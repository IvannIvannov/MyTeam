import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendPushToMember } from "./service";
import { sendPushToAllClubAdminScopes, sendPushToClubAdmins } from "./adminService";
import { MAX_PUSH_PAYLOAD_BYTES } from "./payload";

const mocks = vi.hoisted(() => ({ subscriptions: vi.fn(), history: vi.fn(), send: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, setVapidDetails: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: {
  pushSubscription: { findMany: mocks.subscriptions },
  adminPushSubscription: { findMany: mocks.subscriptions },
} }));
vi.mock("@/lib/push/vapid", () => ({ getVapidConfig: () => ({ subject: "mailto:test@example.com", publicKey: "public", privateKey: "private" }) }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: mocks.history }));
vi.mock("@/lib/push/trainingPause", () => ({ isTrainingNotificationPaused: async () => false }));

describe("long message delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptions.mockResolvedValue([{ id: "subscription", endpoint: "https://example.com/push", p256dh: "key", auth: "auth", createdAt: new Date() }]);
    mocks.send.mockResolvedValue({});
  });

  it("saves the complete member message and sends only a preview", async () => {
    const payload = { title: "Message", body: "А".repeat(10000), url: "/member/ABC" };
    const result = await sendPushToMember("member", payload, "trainer_message");
    expect(result.sent).toBe(1);
    expect(mocks.history).toHaveBeenCalledWith("member", "trainer_message", payload);
    const serialized = mocks.send.mock.calls[0][1];
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(JSON.parse(serialized).body.length).toBeLessThan(payload.body.length);
    expect(payload.body).toBe("А".repeat(10000));
  });

  it("targets only active club-level devices for a subscription fee notification", async () => {
    const payload = { title: "Промяна на абонамента", body: "10.00 EUR → 15.00 EUR", url: "/admin/members?clubId=club" };
    await sendPushToClubAdmins("club", payload, null);
    expect(mocks.subscriptions.mock.calls[0][0].where).toEqual({ clubId: "club", isActive: true, coachGroupId: null });
    expect(JSON.parse(mocks.send.mock.calls[0][1]).url).toBe("/admin/members?clubId=club");
  });

  it.each([sendPushToClubAdmins, sendPushToAllClubAdminScopes])("limits admin pushes while preserving the caller's payload", async send => {
    const payload = { title: "Message", body: "😀".repeat(10000), url: "/admin/members?clubId=club" };
    expect((await send("club", payload)).sent).toBe(1);
    const serialized = mocks.send.mock.calls[0][1];
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(JSON.parse(serialized).url).toBe(payload.url);
    expect(payload.body).toBe("😀".repeat(10000));
  });
});
