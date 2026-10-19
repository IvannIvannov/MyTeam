import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MemberMatchExtraDetails from "@/components/MemberMatchExtraDetails";

describe("shared player game information", () => {
  it("shows official classification and multiline instructions", () => {
    const html = renderToStaticMarkup(<MemberMatchExtraDetails category="official" description={"Екип в бяло\nСбор в 14:00"} />);
    expect(html).toContain("Официален");
    expect(html).toContain("Екип в бяло\nСбор в 14:00");
    expect(html).toContain("white-space:pre-wrap");
  });
  it("shows friendly classification and omits an empty description", () => {
    const html = renderToStaticMarkup(<MemberMatchExtraDetails category="friendly" description="" />);
    expect(html).toContain("Контрола");
    expect(html).not.toContain("Описание");
  });
  it("does not invent a classification for older games", () => {
    expect(renderToStaticMarkup(<MemberMatchExtraDetails />)).toContain("Не е избран");
  });
});
