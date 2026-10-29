import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/discounts/clubs/route";
import { GET } from "@/app/api/members/[cardCode]/route";
import { GET as clubEditorData, POST as saveClubEditor } from "@/app/api/admin/teams/discounts/route";

// Only discount persistence uses SQL; unrelated member-profile services are fixtures.
// PGlite is an in-memory PostgreSQL instance and never reads DATABASE_URL.
const mocks = vi.hoisted(() => ({
  partnerDiscount: { findUnique: vi.fn() },
  club: { findMany: vi.fn() },
  card: { findFirst: vi.fn() },
  playerNotification: { findMany: vi.fn(), count: vi.fn() },
  paymentLog: { findMany: vi.fn() },
  paymentWaiver: { findMany: vi.fn() },
  teamDiscountConfig: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["admin"] }) }));
vi.mock("@/lib/cloudinary", () => ({ cloudinary: {} }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/irispay", () => ({ isIrisPayEnabledForClub: () => false }));

const db = new PGlite();
const clubId = "10000000-0000-4000-8000-000000000001";
const sportId = "10000000-0000-4000-8000-000000000002";
const dalidaId = "10000000-0000-4000-8000-000000000003";
let memberGroup: number | null;

beforeAll(async () => {
  await db.exec("CREATE TABLE clubs(id uuid PRIMARY KEY)");
  await db.exec(readFileSync("prisma/migrations/20260430130000_add_partner_discounts_and_team_discount_configs/migration.sql", "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  memberGroup = null;
  await db.exec("TRUNCATE team_discount_configs, partner_discounts, clubs CASCADE");
  await db.query("INSERT INTO clubs VALUES ($1)", [clubId]);
  await db.query("INSERT INTO partner_discounts(id,name) VALUES ($1,'Sport Depot'),($2,'Dalida Dance Show')", [sportId, dalidaId]);
  await db.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order") VALUES ($1,0,$2,2)', [clubId, sportId]);

  mocks.partnerDiscount.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    (await db.query("SELECT id FROM partner_discounts WHERE id=$1", [where.id])).rows[0] ?? null);
  mocks.club.findMany.mockImplementation(async ({ where }: { where?: { id: { in: string[] } } }) =>
    (await db.query("SELECT id, 'Test Club' AS name FROM clubs WHERE ($1::uuid[] IS NULL OR id=ANY($1::uuid[]))", [where?.id.in ?? null])).rows);
  mocks.card.findFirst.mockImplementation(async () => ({
    cardCode: "TEST-CARD", isActive: true,
    player: { id: "test-player", clubId, fullName: "Test Player", teamGroup: memberGroup,
      images: [], status: "paid", club: { id: clubId, name: "Test Club", playerFields: [], paymentWorkflow: "calendar_month" } },
  }));
  mocks.playerNotification.findMany.mockResolvedValue([]);
  mocks.playerNotification.count.mockResolvedValue(0);
  mocks.paymentLog.findMany.mockResolvedValue([]);
  mocks.paymentWaiver.findMany.mockResolvedValue([]);
  mocks.teamDiscountConfig.findMany.mockImplementation(async ({ where }: { where?: { clubId?: string; teamGroup?: number; isVisible?: boolean } }) => {
    const result = await db.query<{ id: string; name: string; order: number; clubId: string; teamGroup: number; isVisible: boolean }>(
      'SELECT d.id,d.name,c."order",c.club_id AS "clubId",c.team_group AS "teamGroup",c.is_visible AS "isVisible" FROM team_discount_configs c JOIN partner_discounts d ON d.id=c.discount_id WHERE ($1::uuid IS NULL OR c.club_id=$1) AND ($2::integer IS NULL OR c.team_group=$2) AND ($3::boolean IS NULL OR c.is_visible=$3) ORDER BY c."order"',
      [where?.clubId ?? null, where?.teamGroup ?? null, where?.isVisible ?? null],
    );
    return result.rows.map(row => ({ clubId: row.clubId, teamGroup: row.teamGroup, discountId: row.id, isVisible: row.isVisible, order: row.order, discount: { id: row.id, name: row.name, terms: [] } }));
  });
  type TestTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  // Defer batch operations until the transaction starts, like PrismaPromise.
  mocks.teamDiscountConfig.deleteMany.mockImplementation(({ where }: { where: { clubId: string; teamGroup: number } }) =>
    (tx: TestTransaction) => tx.query("DELETE FROM team_discount_configs WHERE club_id=$1 AND team_group=$2", [where.clubId, where.teamGroup]));
  mocks.teamDiscountConfig.createMany.mockImplementation(({ data }: { data: { clubId: string; teamGroup: number; discountId: string; order: number; isVisible: boolean }[] }) =>
    async (tx: TestTransaction) => {
      for (const config of data) await tx.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order",is_visible) VALUES ($1,$2,$3,$4,$5)', [config.clubId, config.teamGroup, config.discountId, config.order, config.isVisible]);
    });
  mocks.$transaction.mockImplementation(async callback => db.transaction(async tx => {
    if (Array.isArray(callback)) {
      for (const operation of callback) await operation(tx);
      return;
    }
    return callback({
    teamDiscountConfig: {
      updateMany: async ({ where, data }: { where: { clubId: string; discountId: string }; data: { isVisible: boolean } }) => {
        await tx.query("UPDATE team_discount_configs SET is_visible=$1 WHERE club_id=$2 AND discount_id=$3", [data.isVisible, where.clubId, where.discountId]);
      },
      aggregate: async ({ where }: { where: { clubId: string; teamGroup: number } }) => ({
        _max: (await tx.query<{ order: number | null }>('SELECT MAX("order") AS "order" FROM team_discount_configs WHERE club_id=$1 AND team_group=$2', [where.clubId, where.teamGroup])).rows[0],
      }),
      upsert: async ({ create }: { create: { clubId: string; teamGroup: number; discountId: string; order: number; isVisible: boolean } }) => {
        await tx.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order",is_visible) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (club_id,team_group,discount_id) DO UPDATE SET is_visible=EXCLUDED.is_visible',
          [create.clubId, create.teamGroup, create.discountId, create.order, create.isVisible]);
      },
    },
    });
  }));
});

async function assignDalida(isVisible = true) {
  const response = await PATCH(new NextRequest("http://localhost/api/admin/discounts/clubs", {
    method: "PATCH", headers: { cookie: "admin_session=test", "Content-Type": "application/json" },
    body: JSON.stringify({ partnerId: dalidaId, changes: [{ clubId, isVisible }] }),
  }));
  expect(response.status).toBe(200);
}

async function memberDiscounts() {
  const response = await GET(new NextRequest("http://localhost/api/members/TEST-CARD"), { params: Promise.resolve({ cardCode: "TEST-CARD" }) });
  expect(response.status).toBe(200);
  const data = await response.json();
  return data.discounts.map((discount: { name: string }) => discount.name);
}

describe("club assignment through PATCH followed by member GET", () => {
  it("reaches a player without a team group, as in the manual Demo 2 check", async () => {
    await assignDalida();
    expect(await memberDiscounts()).toEqual(["Sport Depot", "Dalida Dance Show"]);
  });

  it("reaches a nonzero group without its own visible configurations", async () => {
    memberGroup = 2012;
    await assignDalida();
    expect(await memberDiscounts()).toEqual(["Sport Depot", "Dalida Dance Show"]);
  });

  it("reaches a group with an existing override while preserving its partner and order", async () => {
    memberGroup = 2012;
    await db.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order") VALUES ($1,2012,$2,7)', [clubId, sportId]);
    expect(await memberDiscounts()).toEqual(["Sport Depot"]);
    await assignDalida();
    const existing = await db.query<{ order: number; is_visible: boolean }>('SELECT "order",is_visible FROM team_discount_configs WHERE club_id=$1 AND team_group=2012 AND discount_id=$2', [clubId, sportId]);
    expect(existing.rows).toEqual([{ order: 7, is_visible: true }]);
    expect(await memberDiscounts()).toEqual(["Sport Depot", "Dalida Dance Show"]);
  });

  it("preserves group ordering without duplicating partners also assigned to the club", async () => {
    memberGroup = 2012;
    await db.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order") VALUES ($1,2012,$2,4),($1,2012,$3,9)', [clubId, dalidaId, sportId]);
    await assignDalida();
    expect(await memberDiscounts()).toEqual(["Dalida Dance Show", "Sport Depot"]);
  });

  it("inherits all club partners when the group has only hidden configurations", async () => {
    memberGroup = 2012;
    await db.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order",is_visible) VALUES ($1,2012,$2,7,false)', [clubId, sportId]);
    await assignDalida();
    expect(await memberDiscounts()).toEqual(["Sport Depot", "Dalida Dance Show"]);
  });

  it("removes the partner from both group and club while retaining other discounts", async () => {
    memberGroup = 2012;
    await db.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order") VALUES ($1,2012,$2,4),($1,2012,$3,9)', [clubId, dalidaId, sportId]);
    await assignDalida();
    await assignDalida(false);
    expect(await memberDiscounts()).toEqual(["Sport Depot"]);
  });

  it("loads and saves the club editor after promotion without duplicating or replacing group settings", async () => {
    await db.query('INSERT INTO team_discount_configs(club_id,team_group,discount_id,"order") VALUES ($1,2012,$2,7)', [clubId, dalidaId]);
    await assignDalida();
    const before = await db.query("SELECT * FROM team_discount_configs WHERE team_group=2012");
    const loaded = await clubEditorData(new NextRequest("http://localhost/api/admin/teams/discounts", { headers: { cookie: "admin_session=test" } }));
    expect(loaded.status).toBe(200);
    const clubs = await loaded.json();
    const configs = clubs[0].configs;
    const saved = await saveClubEditor(new NextRequest("http://localhost/api/admin/teams/discounts", {
      method: "POST", headers: { cookie: "admin_session=test", "Content-Type": "application/json" },
      body: JSON.stringify({ clubId, teamGroup: 0, discountConfigs: configs.map((config: { discountId: string; isVisible: boolean }, index: number) => ({ discountId: config.discountId, isVisible: config.isVisible, order: index })) }),
    }));
    expect(saved.status).toBe(200);
    expect(configs).toHaveLength(2);
    expect(configs.every((config: { teamGroup: number }) => config.teamGroup === 0)).toBe(true);
    expect((await db.query("SELECT * FROM team_discount_configs WHERE team_group=2012")).rows).toEqual(before.rows);
    expect((await db.query("SELECT discount_id FROM team_discount_configs WHERE team_group=0")).rows).toHaveLength(2);
  });
});
