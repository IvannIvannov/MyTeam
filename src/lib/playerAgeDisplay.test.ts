import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import { playerFieldEnabled } from "./playerFields";

it.each([
  ["src/app/member/[cardCode]/page.tsx", "info-row", 1],
  ["src/app/admin/members/_components/members-page-components.tsx", "amp-info-cell", 2],
] as const)("displays saved age in %s even when optional fields are disabled", (path, className, count) => {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rows: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" &&
      attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === className) &&
      node.getText(source).includes("member.age")) {
      rows.push(ts.isBinaryExpression(node.parent) ? node.parent : node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(rows).toHaveLength(count);
  for (const row of rows) {
    const script = ts.transpile(`return (${row.getText(source)});`, { jsx: ts.JsxEmit.React });
    const render = new Function("React", "member", "playerFieldEnabled", script);
    for (const age of [12, 0, null]) {
      const html = renderToStaticMarkup(render(React, { age, playerFields: [], club: { playerFields: [] } }, playerFieldEnabled));
      expect(html).toContain("Възраст:");
      expect(html).toContain(age === null ? "—" : String(age));
    }
  }
});
