import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
    return [harness.states[index], (next: unknown) => {
      harness.states[index] = typeof next === "function" ? next(harness.states[index]) : next;
    }];
  },
}));
import PartnerClubsDialog from "./PartnerClubsDialog";

type Button = { "aria-label"?: string; className?: string; disabled?: boolean; onClick?: () => void };
function buttons(node: ReactNode): Button[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Button & { children?: ReactNode }>(child)) return [];
    return [...(child.type === "button" ? [child.props] : []), ...buttons(child.props.children)];
  });
}

const partner = { id: "partner", name: "Dalida", logoUrl: null, badgeText: null };
const onSaved = vi.fn();
function render(configs: { discountId: string; teamGroup: number; isVisible: boolean }[]) {
  harness.cursor = 0;
  return buttons(PartnerClubsDialog({ partner,
    teams: [{ clubId: "club", clubName: "Test Club", clubLogoUrl: null, configs }],
    onClose: vi.fn(), onSaved,
  }));
}
beforeEach(() => { harness.states = []; harness.cursor = 0; onSaved.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

it("allows promoting a group-only assignment to the whole club and submits it", async () => {
  const configs = [{ discountId: partner.id, teamGroup: 2012, isVisible: true }];
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const initialButtons = render(configs);
  const add = initialButtons.find(button => button["aria-label"] === "Добави Test Club");
  expect(add).toBeDefined();
  expect(initialButtons.find(button => button["aria-label"] === "Премахни Test Club")).toBeUndefined();
  add?.onClick?.();
  const save = render(configs).find(button => button.className === "pcd-save");
  expect(save?.disabled).toBe(false);
  save?.onClick?.();
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith("/api/admin/discounts/clubs", expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ partnerId: partner.id, changes: [{ clubId: "club", isVisible: true }] }),
  }));
});

it("selects an existing visible club assignment without generating changes", () => {
  const result = render([{ discountId: partner.id, teamGroup: 0, isVisible: true }]);
  expect(result.find(button => button["aria-label"] === "Премахни Test Club")).toBeDefined();
  expect(result.find(button => button.className === "pcd-save")?.disabled).toBe(true);
});

it("does not select a hidden club assignment even if a group assignment is visible", () => {
  const result = render([{ discountId: partner.id, teamGroup: 0, isVisible: false }, { discountId: partner.id, teamGroup: 2012, isVisible: true }]);
  expect(result.find(button => button["aria-label"] === "Добави Test Club")).toBeDefined();
});
