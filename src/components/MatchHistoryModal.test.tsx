import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, update: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
  useId: () => "history-title",
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => [initial, harness.update],
}));
vi.mock("@/components/MatchAttendancePanel", () => ({ default: () => null }));

import MatchHistoryModal from "@/components/MatchHistoryModal";

function startRequest() {
  MatchHistoryModal({ clubId: "club", onClose: vi.fn() });
  return harness.effects[1]() as () => void;
}

describe("history request cleanup", () => {
  beforeEach(() => { vi.useFakeTimers(); harness.effects.length = 0; harness.update.mockClear(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not produce an AbortError when closing during an active history request", async () => {
    const abortReasons: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => {
      options?.signal?.addEventListener("abort", () => abortReasons.push(options.signal?.reason));
      return new Promise(() => {});
    }));
    const cleanup = startRequest();
    await vi.advanceTimersByTimeAsync(250);
    cleanup();
    expect(abortReasons).toEqual([]);
  });

  it("ignores stale responses after filters change or the modal closes", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
    const cleanup = startRequest();
    await vi.advanceTimersByTimeAsync(250);
    harness.update.mockClear();
    cleanup();
    complete(Response.json({ matches: [], total: 0, page: 1, pageSize: 20 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("clears the debounce timer if closed before the request starts", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    startRequest()();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still reports real request errors while the modal is active", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Server unavailable" }, { status: 503 })));
    startRequest();
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.update).toHaveBeenCalledWith("Server unavailable");
    expect(harness.update).toHaveBeenCalledWith(false);
  });
});
