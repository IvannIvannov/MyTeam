import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import GroupAssignmentFeeNotice from "./GroupAssignmentFeeNotice";
import { previewGroupAssignmentFees, type GroupFeeSettings } from "@/lib/groupAssignmentFees";

const settings: GroupFeeSettings = { paymentAmount: "85.00", revision: "v1",
  groups: [{ id: "a", name: "Група А", paymentAmount: "60.00" }, { id: "b", name: "Група Б", paymentAmount: "80.00" }],
  players: [{ id: "p", fullName: "Играч 1", paymentAmount: "0.00", billingCoachGroupId: null, coachGroupIds: ["a"], isActive: true, teamGroup: null }],
};
it("explains the action and renders fee choices as soon as membership selection conflicts", () => {
  const rows = previewGroupAssignmentFees(settings, "b", new Set(["p"]), {});
  const html = renderToStaticMarkup(<GroupAssignmentFeeNotice rows={rows} clubAmount="85.00" busy={false} onChoice={() => {}} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("Изберете от коя група да се взема таксата");
  expect(html).toContain("След това натиснете „Запази“");
  expect(html).toContain("Група А — 60.00 €");
  expect(html).toContain("Група Б — 80.00 €");
});
it("explains that personal fees remain unchanged instead of requiring a group choice", () => {
  const personal = { ...settings, players: [{ ...settings.players[0], paymentAmount: "45.00" }] };
  const html = renderToStaticMarkup(<GroupAssignmentFeeNotice rows={previewGroupAssignmentFees(personal, "b", new Set(["p"]), {})} clubAmount="85.00" busy={false} onChoice={() => {}} />);
  expect(html).toContain("Личната такса 45.00 € се запазва");
  expect(html).not.toContain("<select");
});
