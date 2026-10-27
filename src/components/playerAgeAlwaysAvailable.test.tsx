import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlayerExtraFields from "./PlayerExtraFields";
import PlayerFieldSettings from "./PlayerFieldSettings";
import { optionalPlayerUpdates, parsePlayerFields } from "../lib/playerFields";

describe("age is a standard player field", () => {
  it("does not offer age as a selectable club field", () => {
    const html = renderToStaticMarkup(<PlayerFieldSettings value={["age"]} onChange={() => {}} />);
    expect(html).not.toContain("Възраст");
    expect(html).toContain("Тегло");
  });
  it.each(["admin", "add"] as const)("does not offer an age input in the %s form", variant => {
    const html = renderToStaticMarkup(<PlayerExtraFields settings={{ playerFields: [] }} values={{ rank: "", weight: "" }} onChange={() => {}} variant={variant} />);
    expect(html).not.toContain("Възраст");
    expect(html).not.toContain('type="number"');
  });
  it("ignores submitted manual ages", () => {
    expect(optionalPlayerUpdates({ age: 12 }, { playerFields: [] })).toEqual({});
  });
  it("removes obsolete age selections when saving club field settings", () => {
    expect(parsePlayerFields(["age", "rank"])).toEqual(["rank"]);
  });
});
