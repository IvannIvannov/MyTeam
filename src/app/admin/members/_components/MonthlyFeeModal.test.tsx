import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MonthlyFeeModal from "./MonthlyFeeModal";

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: () => ({ current: null }),
  useState: (value: unknown) => { const setter = vi.fn(); hooks.setters.push(setter); return [value, setter]; },
}));
beforeEach(() => { hooks.effects = []; hooks.setters = []; vi.unstubAllGlobals(); });
afterEach(() => vi.unstubAllGlobals());

it("ignores a response decoded after the modal has closed", async () => {
  let decode!: (data: unknown) => void;
  const json = vi.fn(() => new Promise((resolve) => { decode = resolve; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json }));
  MonthlyFeeModal({ clubId: "club", onClose: () => {}, onSaved: () => {} });
  const cleanup = hooks.effects[0]();
  await vi.waitFor(() => expect(json).toHaveBeenCalled());
  if (typeof cleanup === "function") cleanup();
  decode({ paymentAmount: "85", groups: [], players: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(hooks.setters.every((setter) => setter.mock.calls.length === 0)).toBe(true);
});

it("still displays genuine loading failures while mounted", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection unavailable")));
  MonthlyFeeModal({ clubId: "club", onClose: () => {}, onSaved: () => {} });
  hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.setters.some((setter) => setter.mock.calls.some(([message]) => message === "Connection unavailable"))).toBe(true));
});
