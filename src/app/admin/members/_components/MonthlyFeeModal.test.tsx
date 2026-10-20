import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MonthlyFeeModal from "./MonthlyFeeModal";

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], setters: [] as ReturnType<typeof vi.fn>[], values: [] as unknown[] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => { const index = hooks.setters.length; const setter = vi.fn(); hooks.setters.push(setter); return [index in hooks.values ? hooks.values[index] : value, setter]; },
}));
beforeEach(() => { hooks.effects = []; hooks.setters = []; hooks.values = []; vi.unstubAllGlobals(); });
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

const loadedSettings = { paymentAmount: "85.00", groups: [], players: [], revision: "v1" };
function dirtyModal() {
  hooks.values = [loadedSettings, "90.00"];
  return MonthlyFeeModal({ clubId: "club", onClose: vi.fn(), onSaved: vi.fn() });
}
it("routes backdrop and Escape closing through the unsaved-changes prompt", () => {
  const tree = dirtyModal();
  tree.props.onClick();
  expect(hooks.setters[9]).toHaveBeenCalledWith(true);
  expect(hooks.setters[9]).toHaveBeenCalledTimes(1);
  const stopPropagation = vi.fn();
  tree.props.children.props.onKeyDown({ key: "Escape", stopPropagation });
  expect(stopPropagation).toHaveBeenCalled();
  expect(hooks.setters[9]).toHaveBeenCalledTimes(2);
});
it("warns before page unload only while dirty and removes its listener on cleanup", () => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal("window", { addEventListener, removeEventListener });
  dirtyModal();
  const cleanup = hooks.effects[2]();
  const handler = addEventListener.mock.calls[0][1];
  const event = { preventDefault: vi.fn(), returnValue: undefined };
  handler(event);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.returnValue).toBe("");
  if (typeof cleanup === "function") cleanup();
  expect(removeEventListener).toHaveBeenCalledWith("beforeunload", handler);
});
it("allows clean modal closing without prompting", () => {
  hooks.values = [loadedSettings, "85.00"];
  const onClose = vi.fn();
  const tree = MonthlyFeeModal({ clubId: "club", onClose, onSaved: vi.fn() });
  tree.props.onClick();
  expect(onClose).toHaveBeenCalledOnce();
  expect(hooks.setters[9]).not.toHaveBeenCalled();
});
