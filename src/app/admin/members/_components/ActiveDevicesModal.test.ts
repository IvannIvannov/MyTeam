import { afterEach, expect, it, vi } from "vitest";
import ActiveDevicesModal from "./ActiveDevicesModal";

const mocks = vi.hoisted(() => ({ effects: [] as (() => unknown)[], setState: vi.fn() }));
vi.mock("react", () => ({
  useState: (value: unknown) => [value, mocks.setState],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => unknown) => { mocks.effects.push(effect); },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.effects.length = 0;
  mocks.setState.mockClear();
});

it("does not abort on cleanup or apply a late response", async () => {
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
    signal = options.signal;
    return new Promise<Response>((done) => { resolve = done; });
  }));
  ActiveDevicesModal({ clubId: "club", onClose: vi.fn() });
  const cleanup = mocks.effects[2]() as () => void;
  mocks.setState.mockClear();
  cleanup();
  expect(signal?.aborted ?? false).toBe(false);
  resolve(new Response(JSON.stringify({ players: [] })));
  await new Promise((done) => setTimeout(done, 0));
  expect(mocks.setState).not.toHaveBeenCalled();
});
