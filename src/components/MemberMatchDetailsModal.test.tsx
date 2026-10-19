import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactElement, ReactNode } from "react";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "confirmation-title",
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = next; }];
  },
}));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
import MemberMatchDetailsModal, { type MemberMatchDetails } from "@/components/MemberMatchDetailsModal";
import MatchAttendanceControl from "@/components/MatchAttendanceControl";

type Props = {
  children?: ReactNode; className?: string; "aria-label"?: string; "aria-pressed"?: boolean;
  onClick: () => void;
  onChange: (event: { target: { value: string } }) => void;
  onSubmit: (event: { preventDefault: () => void }) => void;
};
type Element = ReactElement<Props>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function find(node: ReactNode, predicate: (element: Element) => boolean) {
  const result = elements(node).find(predicate);
  if (!result) throw new Error("Element not found");
  return result;
}
const first: MemberMatchDetails = { id: "first", eventType: "match", opponent: "Първи", location: "Стадион", matchDate: "2099-01-01", matchTime: "14:00", durationMinutes: 90, isHome: true, teamGroups: [], attendanceEnabled: true, present: true, reasonCode: null, reasonText: null };
const second = { ...first, id: "second", opponent: "Втори", matchTime: "16:00" };
afterEach(() => { hooks.slots = []; vi.unstubAllGlobals(); });

describe("member match-only day navigation", () => {
  it("keeps single-game details without an unnecessary selector", () => {
    const node = MemberMatchDetailsModal({ match: first, matches: [first], cardCode: "card", onSelect: vi.fn(), onClose: vi.fn(), onSaved: vi.fn() });
    expect(elements(node).some((element) => element.type === "nav")).toBe(false);
    const control = find(node, (element) => element.type === MatchAttendanceControl);
    expect((control.props as unknown as ComponentProps<typeof MatchAttendanceControl>).endpoint).toBe("/api/members/card/matches/first/attendance");
  });
  it("reaches the second game and withdraws only from that game", async () => {
    vi.stubGlobal("document", { body: {} });
    const matches = [{ ...first }, { ...second }];
    let selected = matches[0];
    const onSaved = vi.fn();
    const render = () => MemberMatchDetailsModal({ match: selected, matches, cardCode: "card", onSelect: (match) => { selected = match; }, onClose: vi.fn(), onSaved });
    let node = render();
    expect(elements(node).filter((element) => element.props["aria-pressed"] !== undefined)).toHaveLength(2);
    find(node, (element) => element.props["aria-label"] === "Мач · 16:00 · Втори").props.onClick();
    node = render();
    const control = find(node, (element) => element.type === MatchAttendanceControl);
    const controlProps = control.props as unknown as ComponentProps<typeof MatchAttendanceControl>;
    expect(controlProps.endpoint).toBe("/api/members/card/matches/second/attendance");
    expect(control.key).toBe("second");
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const target = matches.find((match) => url.includes(`/matches/${match.id}/`))!;
      Object.assign(target, { present: body.present, reasonCode: body.reasonCode });
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetch);
    const renderControl = () => { hooks.cursor = 0; return MatchAttendanceControl(controlProps); };
    let attendance = renderControl();
    find(attendance, (element) => element.type === "button" && element.props.className?.includes("training-optout-btn") === true).props.onClick();
    attendance = renderControl();
    find(attendance, (element) => element.type === "select").props.onChange({ target: { value: "injury" } });
    attendance = renderControl();
    find(attendance, (element) => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    expect(matches[0].present).toBe(true);
    expect(matches[1]).toMatchObject({ present: false, reasonCode: "injury" });
  });
});
