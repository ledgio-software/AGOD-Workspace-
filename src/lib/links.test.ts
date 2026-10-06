import { describe, expect, it } from "vitest";
import { checkLink } from "./links";

describe("checkLink", () => {
  it("recognises Google Drive links", () => {
    expect(checkLink(" https://docs.google.com/document/d/abc/edit ")).toEqual({
      url: "https://docs.google.com/document/d/abc/edit",
      provider: "GOOGLE_DRIVE",
      suggestedTitle: "Google Doc",
    });
    expect(checkLink("https://docs.google.com/spreadsheets/d/x/edit#gid=0")).toMatchObject({ provider: "GOOGLE_DRIVE", suggestedTitle: "Google Sheet" });
    expect(checkLink("https://drive.google.com/drive/folders/123")).toMatchObject({ provider: "GOOGLE_DRIVE", suggestedTitle: "Drive folder" });
    expect(checkLink("https://drive.google.com/file/d/123/view")).toMatchObject({ provider: "GOOGLE_DRIVE", suggestedTitle: "Drive file" });
  });

  it("accepts other https pages as web links", () => {
    expect(checkLink("https://www.figma.com/file/x")).toMatchObject({ provider: "WEB", suggestedTitle: "figma.com" });
  });

  it("refuses anything that isn't a plain https link", () => {
    for (const bad of ["", "not a link", "http://example.com", "javascript:alert(1)", "https://user:pw@example.com", `https://x.com/${"a".repeat(2000)}`]) {
      expect(checkLink(bad)).toHaveProperty("error");
    }
  });
});
