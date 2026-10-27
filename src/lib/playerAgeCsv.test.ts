import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";

// Exercise the importer's actual helper without starting its database import.
const source = ts.createSourceFile("import-players-from-csv.js", readFileSync("scripts/import-players-from-csv.js", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "calculatePlayerAge");
if (!helper) throw new Error("CSV age calculation helper not found");
const calculateAge = new Function(`${helper.getText(source)}; return calculatePlayerAge;`)() as (birthDate: Date | null) => number | null;

afterEach(() => vi.useRealTimers());

it.each([
  ["2026-10-27T21:59:59Z", "2010-10-28", 15],
  ["2026-10-27T22:30:00Z", "2010-10-28", 16],
  ["2026-07-27T21:30:00Z", "2010-07-28", 16],
  ["2025-02-28T22:30:00Z", "2024-02-29", 1],
])("CSV imports use Sofia's date at %s", (now, birthDate, expected) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  expect(calculateAge(new Date(birthDate))).toBe(expected);
});
