import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it("opens birthday player details without clearing the selected birthday date", () => {
  const source = ts.createSourceFile("page.client.tsx", readFileSync("src/app/admin/members/page.client.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some((attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" &&
      attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "amp-birthday-player")) {
      const click = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "onClick");
      if (click && ts.isJsxAttribute(click) && click.initializer && ts.isJsxExpression(click.initializer)) handler = click.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(handler).toBeDefined();
  const member = { id: "birthday-player" };
  let birthdayDate: string | null = "2026-10-28";
  let selectedMember: unknown = null;
  const script = ts.transpile(`(${handler!.getText(source)})()`);
  new Function("member", "setBirthdayDate", "setSelectedMember", script)(member,
    (date: string | null) => { birthdayDate = date; },
    (value: unknown) => { selectedMember = value; });
  expect(selectedMember).toBe(member);
  expect(birthdayDate).toBe("2026-10-28");
});
