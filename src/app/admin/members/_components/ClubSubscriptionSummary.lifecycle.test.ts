import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [initial, setter];
  },
}));
import ClubSubscriptionSummary from "./ClubSubscriptionSummary";

let documentEvents: EventTarget;
let windowEvents: EventTarget;
beforeEach(() => {
  hooks.effects = [];
  hooks.setters = [];
  vi.useFakeTimers();
  documentEvents = new EventTarget();
  windowEvents = new EventTarget();
  vi.stubGlobal("document", { hidden: false, addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) });
  vi.stubGlobal("window", { setInterval, addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount(clubId = "club-a") {
  ClubSubscriptionSummary({ clubId });
  return hooks.effects.at(-1)!() as () => void;
}

it("does not abort an in-flight request during cleanup or update state after it completes", async () => {
  const aborted = vi.fn();
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    finish = resolve;
    init?.signal?.addEventListener("abort", () => {
      aborted(init.signal?.reason);
      reject(init.signal?.reason);
    });
  }));
  vi.stubGlobal("fetch", fetchMock);
  const cleanup = mount();
  cleanup();
  expect(aborted, "cleanup must not trigger the reported AbortError in the fetch runtime").not.toHaveBeenCalled();
  finish(Response.json({ summary: {} }));
  await vi.waitFor(() => expect(fetchMock).toHaveResolved());
  expect(hooks.setters.every(setter => setter.mock.calls.length === 0)).toBe(true);
  windowEvents.dispatchEvent(new Event("focus"));
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("loads and refreshes the active club and reports real request failures", async () => {
  const value = { summary: {} };
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(value)).mockRejectedValueOnce(new Error("Network unavailable"));
  vi.stubGlobal("fetch", fetchMock);
  const cleanup = mount();
  await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenCalledWith({ clubId: "club-a", value }));
  windowEvents.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith("Network unavailable"));
  cleanup();
});

it("ignores a stale request failure after switching clubs and keeps the new effect active", async () => {
  let rejectOld!: (error: Error) => void;
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectOld = reject; }))
    .mockResolvedValue(Response.json({ summary: { status: "active" } }));
  vi.stubGlobal("fetch", fetchMock);
  const cleanupOld = mount();
  cleanupOld();
  const cleanupNew = mount("club-b");
  await vi.waitFor(() => expect(hooks.setters[3]).toHaveBeenCalledWith({ clubId: "club-b", value: { summary: { status: "active" } } }));
  rejectOld(new Error("Old request failed"));
  await vi.waitFor(() => expect(fetchMock).toHaveResolvedTimes(1));
  expect(hooks.setters[0]).not.toHaveBeenCalled();
  expect(hooks.setters[1]).not.toHaveBeenCalled();
  cleanupNew();
});
