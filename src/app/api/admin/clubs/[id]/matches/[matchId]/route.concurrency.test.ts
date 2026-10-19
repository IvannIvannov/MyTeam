import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { hasMatchFinished } from "@/lib/matchResult";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: async () => ({ roles: ["coach"] }) }));
vi.mock("@/lib/db", () => ({ prisma: { clubMatch: { findFirst: mocks.find, update: mocks.update } } }));
vi.mock("@/lib/matchConflicts", () => ({ getMatchOverlapWarnings: async () => [] }));
vi.mock("@/lib/push/matchScheduleNotifications", () => ({ hasMatchScheduleChanged: () => false, sendMatchScheduleNotifications: vi.fn() }));

const db = new PGlite();
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function patch(body: Record<string, unknown>) {
  return PATCH(new NextRequest("http://localhost/api/admin/clubs/club/matches/match", {
    method: "PATCH", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "club", matchId: "match" }) });
}

beforeAll(async () => {
  await db.exec(`CREATE TABLE matches (
    id TEXT PRIMARY KEY, "clubId" TEXT, "matchDate" TEXT, "matchTime" TEXT,
    "durationMinutes" INTEGER, "homeScore" INTEGER, "awayScore" INTEGER
  )`);
});
afterAll(async () => { await db.close(); });

describe("concurrent result recording and rescheduling", () => {
  it.each(["result", "reschedule"])("rejects the stale write when %s commits first", async (firstWriter) => {
    await db.exec(`DELETE FROM matches; INSERT INTO matches VALUES ('match', 'club', '2020-01-01', '12:00', 90, NULL, NULL)`);
    const bothRead = latch();
    const firstWritten = latch();
    let reads = 0;
    mocks.find.mockImplementation(async () => {
      const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM matches WHERE id = 'match'");
      if (++reads === 2) bothRead.release();
      await bothRead.promise;
      return { ...rows[0], customGroupId: null, eventType: "match", opponent: "Съперник", location: "Стадион", isHome: true, teamGroups: [] };
    });
    // Execute the route's actual update predicate against PostgreSQL semantics.
    mocks.update.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const writer = Object.hasOwn(data, "homeScore") ? "result" : "reschedule";
      if (writer !== firstWriter) await firstWritten.promise;
      const params: unknown[] = [];
      const assignments = Object.entries(data).map(([key, value]) => { params.push(value); return `"${key}" = $${params.length}`; });
      const predicates = Object.entries(where).map(([key, value]) => { params.push(value); return `"${key}" IS NOT DISTINCT FROM $${params.length}`; });
      try {
        const { rows } = await db.query(`UPDATE matches SET ${assignments.join(", ")} WHERE ${predicates.join(" AND ")} RETURNING *`, params);
        if (!rows.length) throw Object.assign(new Error("Record changed"), { code: "P2025" });
        return rows[0];
      } finally { if (writer === firstWriter) firstWritten.release(); }
    });
    const responses = await Promise.all([
      patch({ homeScore: 2, awayScore: 1 }),
      patch({ matchDate: "2099-01-01" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const { rows } = await db.query<{ matchDate: string; matchTime: string; durationMinutes: number; homeScore: number | null }>("SELECT * FROM matches");
    expect(rows[0].homeScore === null || hasMatchFinished(rows[0])).toBe(true);
    expect(rows[0]).toMatchObject(firstWriter === "result" ? { matchDate: "2020-01-01", homeScore: 2 } : { matchDate: "2099-01-01", homeScore: null });
  });
});
