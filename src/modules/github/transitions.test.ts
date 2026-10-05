import { describe, expect, it } from "vitest";
import { nextTaskStatus, pullRequestState } from "./transitions";

describe("pull request → task status", () => {
  it("reads the pull request state", () => {
    expect(pullRequestState({ state: "open", draft: true })).toBe("draft");
    expect(pullRequestState({ state: "open", draft: false })).toBe("open");
    expect(pullRequestState({ state: "closed", merged: true })).toBe("merged");
    expect(pullRequestState({ state: "closed", merged_at: "2026-10-05T10:00:00Z" })).toBe("merged");
    expect(pullRequestState({ state: "closed", merged: false })).toBe("closed");
  });

  it("moves tasks forward through review to QA", () => {
    expect(nextTaskStatus("NOT_STARTED", "draft")).toBe("IN_PROGRESS");
    expect(nextTaskStatus("IN_PROGRESS", "draft")).toBeNull();
    expect(nextTaskStatus("IN_PROGRESS", "open")).toBe("IN_REVIEW");
    expect(nextTaskStatus("BLOCKED", "open")).toBeNull();
    expect(nextTaskStatus("IN_REVIEW", "merged")).toBe("READY_FOR_QA");
    expect(nextTaskStatus("BLOCKED", "merged")).toBe("READY_FOR_QA");
    expect(nextTaskStatus("READY_FOR_QA", "merged")).toBeNull();
    expect(nextTaskStatus("READY_FOR_QA", "open")).toBeNull();
  });

  it("returns a closed, unmerged review to in progress and never touches done or waived", () => {
    expect(nextTaskStatus("IN_REVIEW", "closed")).toBe("IN_PROGRESS");
    expect(nextTaskStatus("READY_FOR_QA", "closed")).toBeNull();
    for (const pr of ["draft", "open", "merged", "closed"] as const) {
      expect(nextTaskStatus("DONE", pr)).toBeNull();
      expect(nextTaskStatus("WAIVED", pr)).toBeNull();
    }
  });
});
