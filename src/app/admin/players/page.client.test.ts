import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it("does not render stray text between the players page sections", () => {
  const source = ts.createSourceFile("page.client.tsx", readFileSync("src/app/admin/players/page.client.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let container: ts.JsxElement | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" &&
      attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "mp-inner")) container = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(container).toBeDefined();
  const text = container!.children.filter(ts.isJsxText).map((child) => child.text.trim()).filter(Boolean);
  expect(text).toEqual([]);
});
