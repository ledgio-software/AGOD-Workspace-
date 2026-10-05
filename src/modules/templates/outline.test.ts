import { describe, expect, it } from "vitest";
import { formatOutline, outlineCounts, parseOutline } from "./outline";

const text = `
- Kick-off | +2d | 2h
# Design
- Wireframes | 12h | +10d
* Handover notes | optional
# Build
- Pages|+25d|24 hours
`;

describe("template outlines", () => {
  it("parses milestones, tasks, offsets, estimates and optional tasks", () => {
    const { outline, errors } = parseOutline(text);
    expect(errors).toEqual([]);
    expect(outline.looseTasks).toEqual([{ title: "Kick-off", dueOffsetDays: 2, estimateHours: 2, required: true }]);
    expect(outline.milestones.map((m) => m.title)).toEqual(["Design", "Build"]);
    expect(outline.milestones[0].tasks[1]).toEqual({ title: "Handover notes", dueOffsetDays: null, estimateHours: null, required: false });
    expect(outline.milestones[1].tasks[0]).toMatchObject({ title: "Pages", dueOffsetDays: 25, estimateHours: 24 });
    expect(outlineCounts(outline)).toEqual({ milestones: 2, tasks: 4, hours: 38 });
  });

  it("round-trips through the text format", () => {
    const { outline } = parseOutline(text);
    expect(parseOutline(formatOutline(outline)).outline).toEqual(outline);
  });

  it("reports unreadable lines with their line number", () => {
    const { errors } = parseOutline("# Design\nWireframes\n- Pages | soon\n- X");
    expect(errors).toEqual([
      'Line 2: start with "# " for a milestone or "- " for a task.',
      'Line 3: "soon" is not understood (use +5d, 8h or optional).',
      "Line 4: a task needs a title.",
    ]);
  });

  it("needs at least one task", () => {
    expect(parseOutline("# Only a milestone").errors).toContain("Add at least one task.");
  });
});
