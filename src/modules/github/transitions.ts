import type { TaskStatus } from "@/modules/projects/rules";

// How pull requests move linked tasks (roadmap 2.5):
//   PR opened (not draft) -> In review     PR merged -> Ready for QA     PM verifies -> Done
// Draft PRs mark untouched tasks In progress; a PR closed without merging returns In review to
// In progress. Done and Waived are never changed automatically, and nothing moves backwards
// from Ready for QA.

export type PullRequestState = "draft" | "open" | "merged" | "closed";

export function pullRequestState(pr: { draft?: boolean; state: string; merged?: boolean; merged_at?: string | null }): PullRequestState {
  if (pr.merged || pr.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  return pr.draft ? "draft" : "open";
}

export function nextTaskStatus(current: TaskStatus, pr: PullRequestState): TaskStatus | null {
  if (current === "DONE" || current === "WAIVED") return null;
  switch (pr) {
    case "draft":
      return current === "NOT_STARTED" ? "IN_PROGRESS" : null;
    case "open":
      return current === "NOT_STARTED" || current === "IN_PROGRESS" ? "IN_REVIEW" : null;
    case "merged":
      return current === "READY_FOR_QA" ? null : "READY_FOR_QA";
    case "closed":
      return current === "IN_REVIEW" ? "IN_PROGRESS" : null;
  }
}
