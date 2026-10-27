import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as createClub } from "../app/api/admin/teams/route";
import { PUT as editClub } from "../app/api/admin/teams/[id]/route";
import { POST as createPlayer } from "../app/api/admin/members/route";
import { PUT as editPlayer } from "../app/api/admin/members/[id]/route";
import { PUT as editOwnProfile } from "../app/api/members/[cardCode]/route";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), clubFind: vi.fn(), clubCreate: vi.fn(), clubUpdate: vi.fn(), lock: vi.fn(),
  playerCreate: vi.fn(), playerFind: vi.fn(), playerCurrent: vi.fn(), playerUpdate: vi.fn(), cardFind: vi.fn(),
}));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verify }));
vi.mock("@/lib/cloudinary", () => ({ cloudinary: { uploader: { destroy: vi.fn() } } }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/db", () => {
  const db = {
    $queryRaw: mocks.lock,
    club: { findUnique: mocks.clubFind, findUniqueOrThrow: mocks.clubFind, create: mocks.clubCreate, update: mocks.clubUpdate },
    player: { create: mocks.playerCreate, findUnique: mocks.playerFind, findUniqueOrThrow: mocks.playerCurrent, update: mocks.playerUpdate },
    card: { findFirst: mocks.cardFind },
  };
  return { prisma: { ...db, $transaction: (fn: (tx: unknown) => unknown) => fn(db) }, withPrismaPoolRetry: (fn: () => unknown) => fn() };
});
const allFields = ["rank", "weight", "jerseyNumber", "teamGroup"];
let settings: { playerFields: string[]; trainingGroupMode: string; defaultPaymentAmount: number; paymentWorkflow: string };
let stored: Record<string, unknown>;
function request(body: Record<string, unknown>, method = "PUT") {
  return new NextRequest("http://localhost/api/test", { method, headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ id: "club" }) };
beforeEach(() => {
  vi.clearAllMocks();
  settings = { playerFields: [...allFields], trainingGroupMode: "custom_group", defaultPaymentAmount: 0, paymentWorkflow: "calendar_month" };
  stored = { id: "player", clubId: "club", fullName: "Player", rank: "1 дан", weight: 72.5, jerseyNumber: "7", teamGroup: 2014, images: [], cards: [], paymentLogs: [], coachGroups: [], paymentAmount: 0, billingCoachGroupId: null };
  mocks.verify.mockResolvedValue({ roles: ["admin"] });
  mocks.clubFind.mockImplementation(async () => ({ id: "club", ...settings }));
  mocks.clubCreate.mockImplementation(async ({ data }) => ({ id: "new", ...data }));
  mocks.clubUpdate.mockImplementation(async ({ data }) => ({ id: "club", ...data }));
  mocks.playerCreate.mockImplementation(async ({ data }) => ({ ...data, images: [] }));
  mocks.playerFind.mockImplementation(async () => ({ ...stored, club: settings }));
  mocks.playerCurrent.mockImplementation(async () => ({ ...stored, club: settings }));
  mocks.playerUpdate.mockImplementation(async ({ data }) => { Object.assign(stored, data); return { ...stored, club: settings }; });
  mocks.cardFind.mockImplementation(async () => ({ playerId: "player", player: { club: settings } }));
});

describe("club field settings", () => {
  it("creates clubs with all optional fields hidden and custom scheduling by default", async () => {
    const response = await createClub(request({ name: "Karate" }, "POST"));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ playerFields: [], trainingGroupMode: "custom_group" });
  });
  it("persists explicitly selected fields", async () => {
    const response = await createClub(request({ name: "Karate", playerFields: ["rank", "weight"] }, "POST"));
    expect(await response.json()).toMatchObject({ playerFields: ["rank", "weight"] });
  });
  it("requires switching away from cohort scheduling before hiding Набор", async () => {
    settings.trainingGroupMode = "team_group";
    const response = await editClub(request({ name: "Karate", playerFields: ["rank"] }), params);
    expect(response.status).toBe(409); expect(mocks.clubUpdate).not.toHaveBeenCalled();
    settings.trainingGroupMode = "custom_group";
    expect((await editClub(request({ name: "Karate", playerFields: ["rank"] }), params)).status).toBe(200);
    expect(mocks.lock).toHaveBeenCalled();
  });
  it("keeps settings when older callers omit them", async () => {
    expect((await editClub(request({ name: "Karate" }), params)).status).toBe(200);
    expect(mocks.clubUpdate.mock.calls[0][0].data.playerFields).toBeUndefined();
  });
  it.each(["POST", "PUT"])("rejects non-admin field configuration via %s", async method => {
    mocks.verify.mockResolvedValue({ roles: ["coach"] });
    const response = method === "POST" ? await createClub(request({ name: "Club" }, method)) : await editClub(request({ name: "Club" }), params);
    expect(response.status).toBe(403);
  });
});

for (const audience of ["admin", "player"] as const) {
  describe(`${audience} player edits`, () => {
    const edit = (body: Record<string, unknown>) => audience === "admin"
      ? editPlayer(request({ fullName: "Player", ...body }), { params: Promise.resolve({ id: "player" }) })
      : editOwnProfile(request(body), { params: Promise.resolve({ cardCode: "CARD" }) });
    it("saves enabled rank and decimal kilograms", async () => {
      expect((await edit({ rank: "  2 дан ", weight: "74,25" })).status).toBe(200);
      expect(stored).toMatchObject({ rank: "2 дан", weight: 74.25, jerseyNumber: "7", teamGroup: 2014 });
    });
    it("preserves all hidden values even if a stale form submits replacements", async () => {
      settings.playerFields = [];
      expect((await edit({ rank: null, weight: -1, jerseyNumber: null, teamGroup: null })).status).toBe(200);
      expect(stored).toMatchObject({ rank: "1 дан", weight: 72.5, jerseyNumber: "7", teamGroup: 2014 });
    });
    it("permits clearing enabled fields", async () => {
      expect((await edit({ rank: null, weight: "", jerseyNumber: null, teamGroup: null })).status).toBe(200);
      expect(stored).toMatchObject({ rank: null, weight: null, jerseyNumber: null, teamGroup: null });
    });
    it("rejects invalid enabled weight without saving", async () => {
      expect((await edit({ weight: -1 })).status).toBe(400);
      expect(mocks.playerUpdate).not.toHaveBeenCalled();
    });
  });
}

describe("player creation", () => {
  it("persists only the optional fields selected by the club", async () => {
    settings.playerFields = ["rank", "weight"];
    const response = await createPlayer(request({ clubId: "club", fullName: "Player", rank: "5 кю", weight: "55,5", jerseyNumber: "9", teamGroup: 2012 }, "POST"));
    expect(response.status).toBe(201);
    const data = mocks.playerCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ rank: "5 кю", weight: 55.5 });
    expect(data).not.toHaveProperty("jerseyNumber"); expect(data).not.toHaveProperty("teamGroup");
  });
  it("accepts a player without optional data", async () => {
    expect((await createPlayer(request({ clubId: "club", fullName: "Player" }, "POST"))).status).toBe(201);
  });
  it("rejects invalid weight before creating a player", async () => {
    expect((await createPlayer(request({ clubId: "club", fullName: "Player", weight: 0 }, "POST"))).status).toBe(400);
    expect(mocks.playerCreate).not.toHaveBeenCalled();
  });
});
it("uses destination club settings during an admin player transfer", async () => {
  mocks.clubFind.mockResolvedValue({ id: "destination", ...settings, playerFields: ["rank"] });
  const response = await editPlayer(request({ fullName: "Player", clubId: "destination", rank: "2 дан", weight: 99, teamGroup: null, jerseyNumber: null }), { params: Promise.resolve({ id: "player" }) });
  expect(response.status).toBe(200);
  expect(stored).toMatchObject({ clubId: "destination", rank: "2 дан", weight: 72.5, teamGroup: 2014, jerseyNumber: "7" });
});

describe("age persistence", () => {
  it.each(["admin", "coach"])("calculates age on creation by %s", async role => {
    mocks.verify.mockResolvedValue({ roles: [role] });
    const response = await createPlayer(request({ clubId: "club", fullName: "Player", birthDate: "2010-01-01", confirmDuplicate: true }, "POST"));
    expect(response.status).toBe(201);
    expect(mocks.playerCreate.mock.calls[0][0].data.age).toBe(new Date().getUTCFullYear() - 2010);
  });
  it("ignores manual age on creation", async () => {
    expect((await createPlayer(request({ clubId: "club", fullName: "Player", age: 12 }, "POST"))).status).toBe(201);
    expect(mocks.playerCreate.mock.calls[0][0].data.age).toBeNull();
  });
  it.each(["admin", "coach"])("ignores a manual age submitted by %s", async role => {
    mocks.verify.mockResolvedValue({ roles: [role] });
    stored.birthDate = new Date("2010-01-01");
    stored.age = 16;
    const response = await editPlayer(request({ fullName: "Player", birthDate: "2010-01-01", age: 20 }), { params: Promise.resolve({ id: "player" }) });
    expect(response.status).toBe(200);
    expect(stored.age).toBe(16);
  });
  it("recalculates age when birthdate changes even if stale age is submitted", async () => {
    stored.birthDate = new Date("2010-01-01");
    expect((await editPlayer(request({ fullName: "Player", birthDate: "2012-01-01", age: 20 }), { params: Promise.resolve({ id: "player" }) })).status).toBe(200);
    expect(stored.age).toBe(new Date().getUTCFullYear() - 2012);
  });
  it("preserves birthdate and age on unrelated edits", async () => {
    stored.birthDate = new Date("2010-01-01"); stored.age = 20;
    expect((await editPlayer(request({ fullName: "Player" }), { params: Promise.resolve({ id: "player" }) })).status).toBe(200);
    expect(stored.birthDate).toEqual(new Date("2010-01-01"));
    expect(stored.age).toBe(20);
  });
  it("does not allow members to override their age directly", async () => {
    stored.age = 20;
    expect((await editOwnProfile(request({ fullName: "Player", age: 99 }), { params: Promise.resolve({ cardCode: "CARD" }) })).status).toBe(200);
    expect(stored.age).toBe(20);
  });
  it("recalculates age when a member changes birthdate", async () => {
    expect((await editOwnProfile(request({ birthDate: "2012-01-01" }), { params: Promise.resolve({ cardCode: "CARD" }) })).status).toBe(200);
    expect(stored.age).toBe(new Date().getUTCFullYear() - 2012);
  });
});
it("ignores invalid manual ages", async () => {
  stored.age = 16;
  expect((await editPlayer(request({ fullName: "Player", age: -1 }), { params: Promise.resolve({ id: "player" }) })).status).toBe(200);
  expect(stored.age).toBe(16);
});
it("clears age when the birthdate is removed", async () => {
  stored.birthDate = new Date("2010-01-01"); stored.age = 20;
  expect((await editPlayer(request({ fullName: "Player", birthDate: null }), { params: Promise.resolve({ id: "player" }) })).status).toBe(200);
  expect(stored.age).toBeNull();
});

afterEach(() => vi.useRealTimers());
it.each(["create", "admin edit", "member edit"])("saves the Sofia birthday age during %s", async action => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T22:30:00Z"));
  stored.birthDate = new Date("2010-10-27");
  const body = { fullName: "Player", birthDate: "2010-10-28" };
  const response = action === "create"
    ? await createPlayer(request({ ...body, clubId: "club", confirmDuplicate: true }, "POST"))
    : action === "admin edit"
      ? await editPlayer(request(body), { params: Promise.resolve({ id: "player" }) })
      : await editOwnProfile(request(body), { params: Promise.resolve({ cardCode: "CARD" }) });
  expect(response.status).toBe(action === "create" ? 201 : 200);
  expect(action === "create" ? mocks.playerCreate.mock.calls[0][0].data.age : stored.age).toBe(16);
});
