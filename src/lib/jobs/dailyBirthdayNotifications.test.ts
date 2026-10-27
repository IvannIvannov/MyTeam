import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
import { runDailyBirthdayNotifications } from "./dailyBirthdayNotifications";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), birthdays: vi.fn(), sent: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $executeRaw: mocks.execute, $queryRaw: mocks.birthdays, playerNotification: { findMany: mocks.sent } } }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: mocks.push }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: vi.fn() }));

it("updates stale ages in one statement, catches missed birthdays and writes nothing on repeat runs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE players (id integer PRIMARY KEY, birth_date date, age integer, is_active boolean DEFAULT true);
      INSERT INTO players (id, birth_date, age, is_active) VALUES
        (1, '2010-10-28', 15, true),
        (2, '2012-10-27', 13, false),
        (3, '2011-10-29', 14, true),
        (4, '2014-01-01', NULL, true),
        (5, NULL, NULL, true),
        (6, '2999-01-01', NULL, true),
        (7, '2026-10-28', NULL, true);`);
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce((text, fragment, index) => text + (index ? `$${index}` : "") + fragment, "");
      return (await db.query(sql, values)).affectedRows;
    });
    mocks.birthdays.mockResolvedValue([]);
    // Sofia is already October 28 while UTC is still October 27.
    const now = new Date("2026-10-27T22:30:00Z");
    expect(await runDailyBirthdayNotifications(now)).toMatchObject({ success: true, agesUpdated: 4, targetMembers: 0 });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect((await db.query("SELECT id, age FROM players ORDER BY id")).rows).toEqual([
      { id: 1, age: 16 }, { id: 2, age: 14 }, { id: 3, age: 14 },
      { id: 4, age: 12 }, { id: 5, age: null }, { id: 6, age: null }, { id: 7, age: 0 },
    ]);
    expect(await runDailyBirthdayNotifications(now)).toMatchObject({ agesUpdated: 0 });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    // An already-notified birthday must not prevent the age update.
    await db.exec("UPDATE players SET age = 15 WHERE id = 1");
    mocks.birthdays.mockResolvedValue([{ id: "1", full_name: "Player", card_code: null }]);
    mocks.sent.mockResolvedValue([{ playerId: "1" }]);
    expect(await runDailyBirthdayNotifications(now)).toMatchObject({ agesUpdated: 1, alreadySentToday: 1, targetMembers: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
  } finally { await db.close(); }
}, 30000);
