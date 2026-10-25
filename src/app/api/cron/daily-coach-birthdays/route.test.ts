import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/jobs/weeklyCoachBirthdays", () => ({ runDailyCoachBirthdays: run }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "test-cron-secret"); });
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthenticated calls without running the job", async () => {
  expect((await GET(new NextRequest("http://localhost/api/cron/daily-coach-birthdays"))).status).toBe(401);
  expect(run).not.toHaveBeenCalled();
});
it("accepts Vercel bearer authentication and the local cron header", async () => {
  run.mockResolvedValue({ success: true, notifiedGroups: 2 });
  for (const [handler, headers] of [[GET, { authorization: "Bearer test-cron-secret" }], [POST, { "x-cron-secret": "test-cron-secret" }]] as const) {
    const response = await handler(new NextRequest("http://localhost/api/cron/daily-coach-birthdays", { headers }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ notifiedGroups: 2 });
  }
});
it("reports job failures for the scheduler", async () => {
  run.mockResolvedValue({ success: false, failedGroups: ["group"] });
  expect((await GET(new NextRequest("http://localhost/api/cron/daily-coach-birthdays", { headers: { authorization: "Bearer test-cron-secret" } }))).status).toBe(500);
});
