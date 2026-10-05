import { formatDateTime } from "@/lib/dates";
import { suggestedBranch, taskKey } from "@/lib/github/refs";
import type { TaskLink } from "@/modules/github";
import { createIssueAction, linkGithubAction, unlinkGithubAction } from "../actions";
import { LinkGithubForm, SmallButtonForm } from "./workspace-forms";

const kindLabel = { ISSUE: "Issue", PULL_REQUEST: "PR", COMMIT: "Commit", BRANCH: "Branch" } as const;
const stateClass: Record<string, string> = {
  open: "text-green-700 dark:text-green-400",
  draft: "text-zinc-500",
  merged: "text-violet-700 dark:text-violet-400",
  closed: "text-red-700 dark:text-red-400",
};

function linkLabel(l: TaskLink) {
  const id = l.number !== null ? `#${l.number}` : (l.ref ?? "").slice(0, l.kind === "COMMIT" ? 7 : 60);
  return `${kindLabel[l.kind]} ${l.repo}${l.number !== null ? id : `@${id}`}`;
}

/** GitHub key, suggested branch and links for one task (roadmap 2.5). */
export function TaskGithub({
  projectId,
  projectCode,
  task,
  links,
  canLink,
  canManage,
  canCreateIssue,
}: {
  projectId: string;
  projectCode: string;
  task: { id: string; number: number; title: string };
  links: TaskLink[];
  canLink: boolean;
  canManage: boolean;
  canCreateIssue: boolean;
}) {
  const key = taskKey(projectCode, task.number);
  return (
    <div className="space-y-1">
      <div className="text-xs text-zinc-500">
        Key <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">{key}</code>
        {canLink && (
          <>
            {" "}
            · branch <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">{suggestedBranch("backend", key, task.title)}</code>
          </>
        )}
      </div>
      {links.length > 0 && (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-2 text-xs">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline">
                {linkLabel(l)}
              </a>
              {l.title && <span className="text-zinc-600 dark:text-zinc-400">{l.title}</span>}
              {l.state && <span className={stateClass[l.state] ?? "text-zinc-500"}>{l.state}</span>}
              {l.reviewState && (
                <span className={l.reviewState === "approved" ? "text-green-700" : l.reviewState === "changes_requested" ? "text-red-700" : "text-zinc-500"}>
                  review: {l.reviewState.replace("_", " ")}
                  {l.reviewers.length > 0 && ` (${l.reviewers.join(", ")})`}
                </span>
              )}
              {l.mergedAt && <span className="text-zinc-500">merged {formatDateTime(l.mergedAt)}</span>}
              {l.deployedTo.map((d) => (
                <span key={d.environment} className="rounded bg-green-100 px-1 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                  deployed: {d.environment}
                </span>
              ))}
              {!l.linkedBy && <span className="text-zinc-400">auto</span>}
              {canManage && (
                <SmallButtonForm action={unlinkGithubAction.bind(null, projectId, l.id)} label="Remove" confirmMessage="Remove this GitHub link from the task?" />
              )}
            </li>
          ))}
        </ul>
      )}
      {canLink && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">Link GitHub</summary>
          <div className="mt-2 space-y-2">
            <LinkGithubForm action={linkGithubAction.bind(null, projectId, task.id)} />
            {canCreateIssue && <SmallButtonForm action={createIssueAction.bind(null, projectId, task.id)} label="Create a GitHub issue for this task" />}
          </div>
        </details>
      )}
    </div>
  );
}

type Delivery = {
  repo: string | null;
  mergedPullRequests: TaskLink[];
  deployments: { id: string; environment: string; state: string; sha: string; url: string | null; ref: string | null; updatedAt: Date }[];
  releases: { id: string; tag: string; name: string | null; url: string; publishedAt: Date | null }[];
};

/** Release and deployment history for the project's repository. */
export function DeliveryHistory({ delivery, taskKeys }: { delivery: Delivery; taskKeys: Map<string, string> }) {
  const none = <p className="text-sm text-zinc-500">None yet.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Merged pull requests</h3>
        {delivery.mergedPullRequests.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {delivery.mergedPullRequests.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline">
                    #{l.number}
                  </a>{" "}
                  {taskKeys.get(l.taskId)} {l.title && <span className="text-zinc-500">· {l.title}</span>}
                  {l.deployedTo.length > 0 && <span className="text-green-700"> · deployed ({l.deployedTo.map((d) => d.environment).join(", ")})</span>}
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Deployments</h3>
        {delivery.deployments.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {delivery.deployments.map((d) => (
                <li key={d.id}>
                  <span className={d.state === "success" ? "text-green-700" : d.state === "failure" || d.state === "error" ? "text-red-700" : "text-zinc-500"}>
                    {d.state}
                  </span>{" "}
                  · {d.environment} · <code>{d.sha.slice(0, 7)}</code> · {formatDateTime(d.updatedAt)}
                  {d.url && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="underline">
                        open
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Releases</h3>
        {delivery.releases.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {delivery.releases.map((r) => (
                <li key={r.id}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {r.tag}
                  </a>
                  {r.name && r.name !== r.tag && <span className="text-zinc-500"> · {r.name}</span>}
                  {r.publishedAt && <span className="text-zinc-500"> · {formatDateTime(r.publishedAt)}</span>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
