import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  card: { findUnique: vi.fn() },
  partnerDiscount: { findMany: vi.fn(), findFirst: vi.fn() },
  partnerDiscountUsage: { create: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue(true) }));
import { POST } from "@/app/api/members/[cardCode]/discount-usage/route";
import { GET } from "@/app/api/admin/discount-stats/route";

describe("discount usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.card.findUnique.mockResolvedValue({ playerId: "player" });
    db.partnerDiscount.findFirst.mockResolvedValue({ name: "New Partner" });
    db.partnerDiscount.findMany.mockResolvedValue([{ name: "New Partner", logoUrl: "/new.png" }]);
    db.partnerDiscountUsage.groupBy.mockResolvedValue([{ partner: "New Partner", action: "view", _count: { id: 2 } }]);
    db.partnerDiscountUsage.findMany.mockResolvedValue([]);
  });
  it.each(["view", "copy", "link_click"])("records %s for an actual discount name", async (action) => {
    const response = await POST(new NextRequest("http://localhost/api/members/card/discount-usage", {
      method: "POST", body: JSON.stringify({ partner: "New Partner", action }),
    }), { params: Promise.resolve({ cardCode: "card" }) });
    expect(response.status).toBe(200);
    expect(db.partnerDiscountUsage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ partner: "New Partner", action }) }));
  });
  it("includes configured discounts and their counts beyond the original four", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/discount-stats", { headers: { cookie: "admin_session=token" } }));
    const data = await response.json();
    expect(data.totals["New Partner"]).toEqual({ view: 2, copy: 0, link_click: 0 });
    expect(data.partners).toContainEqual({ name: "New Partner", logoUrl: "/new.png" });
  });
  it("includes discounts with no activity", async () => {
    db.partnerDiscountUsage.groupBy.mockResolvedValue([]);
    const response = await GET(new NextRequest("http://localhost/api/admin/discount-stats", { headers: { cookie: "admin_session=token" } }));
    expect((await response.json()).totals["New Partner"]).toEqual({ view: 0, copy: 0, link_click: 0 });
  });
  it("rejects unknown discounts without writing an event", async () => {
    db.partnerDiscount.findFirst.mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/members/card/discount-usage", {
      method: "POST", body: JSON.stringify({ partner: "Unknown", action: "view" }),
    }), { params: Promise.resolve({ cardCode: "card" }) });
    expect(response.status).toBe(400);
    expect(db.partnerDiscountUsage.create).not.toHaveBeenCalled();
  });
});
