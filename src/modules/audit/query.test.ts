import { describe, expect, it } from "vitest";
import { diffJson } from "./query";

describe("diffJson", () => {
  it("lists only changed fields", () => {
    expect(diffJson({ status: "DRAFT", name: "A" }, { status: "PLANNING", name: "A" })).toEqual([
      { field: "status", before: "DRAFT", after: "PLANNING" },
    ]);
  });

  it("handles creation and removal", () => {
    expect(diffJson(null, { role: "ADMIN" })).toEqual([{ field: "role", before: undefined, after: "ADMIN" }]);
    expect(diffJson({ active: true }, null)).toEqual([{ field: "active", before: true, after: undefined }]);
  });
});
