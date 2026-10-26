import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves native dialog centering despite the global margin reset", () => {
  const css = readFileSync("src/app/admin/members/_components/ClubSubscriptionSummary.module.css", "utf8");
  const dialog = css.match(/\.dialog\s*\{([^}]+)\}/)?.[1];
  expect(dialog).toMatch(/\bmargin:\s*auto\s*;/);
});
