import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "title",
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
    }];
  },
}));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("@/components/MatchAttendancePanel", () => ({ default: () => null }));
import MatchHistoryModal from "@/components/MatchHistoryModal";

type Props = {
  children: ReactNode;
  className?: string;
  onClick: () => void;
  onClose: () => void;
  onSubmit: (event: { preventDefault: () => void }) => void;
  onResultSaved: (id: string, homeScore: number, awayScore: number) => void;
  match: typeof matchA;
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
const matchA = { id: "A", opponent: "A", location: "Field", matchDate: "2020-01-01", matchTime: "12:00", durationMinutes: 90, isHome: true, teamGroups: [], attendanceEnabled: false, customGroup: null, homeScore: 2, awayScore: 1 };
const matchB = { ...matchA, id: "B", opponent: "B", homeScore: 0, awayScore: 3 };
function history() {
  return { matches: [matchA, matchB], total: 2, page: 1, pageSize: 20, customGroups: [], recentForm: [matchB, matchA] };
}
function renderParent(slots: unknown[]) {
  hooks.slots = slots; hooks.cursor = 0;
  return MatchHistoryModal({ clubId: "club", onClose: vi.fn() });
}
function renderChild(element: Element, slots: unknown[]) {
  hooks.slots = slots; hooks.cursor = 0;
  return (element.type as (props: Props) => ReactNode)(element.props);
}
function details(node: ReactNode) {
  return find(node, (element) => typeof element.type === "function" && "onResultSaved" in element.props);
}

afterEach(() => { vi.unstubAllGlobals(); hooks.slots = []; hooks.effects = []; });

describe("history result saves", () => {
  it("keeps B's displayed result when A's PATCH completes after closing A and opening B", async () => {
    vi.stubGlobal("document", { body: {} });
    vi.stubGlobal("HTMLElement", class {});
    let complete!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const parentSlots: unknown[] = [];
    let parent = renderParent(parentSlots);
    // Seed the loaded-history state through the same hook slots used by the component.
    parentSlots[parentSlots.indexOf(true)] = false;
    const dataIndex = parentSlots.indexOf(null);
    parentSlots[dataIndex] = history();
    parent = renderParent(parentSlots);
    const summaries = elements(parent).filter((element) => element.props.className === "match-history-summary");
    summaries[0].props.onClick();
    parent = renderParent(parentSlots);
    const a = details(parent);
    const childSlots: unknown[] = [];
    hooks.effects = [];
    let child = renderChild(a, childSlots);
    const cleanup = hooks.effects[0]();
    find(child, (element) => element.props.className?.includes("match-scoreboard-edit") === true).props.onClick();
    child = renderChild(a, childSlots);
    const pending = find(child, (element) => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/matches/A"), expect.objectContaining({ method: "PATCH" }));
    a.props.onClose();
    if (cleanup) cleanup();
    const closedChildState = [...childSlots];
    parent = renderParent(parentSlots);
    elements(parent).filter((element) => element.props.className === "match-history-summary")[1].props.onClick();
    parent = renderParent(parentSlots);
    expect(details(parent).props.match.id).toBe("B");
    complete(Response.json({ match: { ...matchA, homeScore: 4, awayScore: 2 } }));
    await pending;
    await vi.waitFor(() => {
      parent = renderParent(parentSlots);
      const data = parentSlots[dataIndex] as ReturnType<typeof history>;
      expect(data.matches[0].homeScore).toBe(4);
    });
    expect(details(parent).props.match).toMatchObject({ id: "B", homeScore: 0, awayScore: 3 });
    expect(childSlots).toEqual(closedChildState);
  });

  it("renders the newest result on the right, leaving missing results on the left", () => {
    const slots: unknown[] = [];
    renderParent(slots);
    slots[slots.indexOf(null)] = history();
    const node = renderParent(slots);
    const squares = elements(node).filter((element) => element.props.className?.startsWith("match-history-form-square "));
    expect(squares.map((element) => element.props.children)).toEqual(["—", "—", "—", "П", "З"]);
  });
});
