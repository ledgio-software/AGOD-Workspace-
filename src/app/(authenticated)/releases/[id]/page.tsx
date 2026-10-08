import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, Circle, ShieldAlert, Siren } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, Disclosure } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { type Impact, type ReleaseStatus, getRelease } from "@/modules/releases";
import {
  decideReleaseAction,
  deployReleaseAction,
  rollBackReleaseAction,
  securityReviewAction,
  submitReleaseAction,
  updateReleaseAction,
  withdrawReleaseAction,
} from "../actions";
import { DecideForm, ReleaseForm, StepForm } from "../forms";
import { ImpactBadge, ReleaseStatusBadge } from "../release-ui";

// Phase 32: one release, its record and the next step.

function Step({ done, title, who, at, note, children }: { done: boolean; title: string; who?: string | null; at?: Date | null; note?: string | null; children?: React.ReactNode }) {
  const Icon = done ? CircleCheck : Circle;
  return (
    <li className="flex gap-3">
      <Icon className={done ? "mt-0.5 size-4 shrink-0 text-emerald-600" : "mt-0.5 size-4 shrink-0 text-muted"} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium">{title}</p>
        {who && (
          <p className="text-xs text-muted">
            {who}
            {at ? ` · ${formatDateTime(at)}` : ""}
          </p>
        )}
        {note && <p className="whitespace-pre-line text-muted">{note}</p>}
        {children}
      </div>
    </li>
  );
}

function Text({ label, children }: { label: string; children: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="whitespace-pre-line text-sm">{children}</dd>
    </div>
  );
}

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  const detail = await getRelease(actor, id);
  if (!detail) notFound();
  const { release: r, project, people, can, blocked } = detail;
  const status = r.status as ReleaseStatus;
  const awaiting = !r.decidedBy && (status === "SUBMITTED" || (status === "DEPLOYED" && r.emergency));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Link href={`/projects/${project.id}?tab=releases`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> <span className="font-mono text-xs">{project.code}</span> {project.name}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          {r.versionLabel && <span className="font-mono text-sm text-muted">{r.versionLabel}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <ReleaseStatusBadge status={status} emergency={r.emergency} decision={r.decision} />
          <ImpactBadge impact={r.securityImpact as Impact} />
          {r.emergency && <Badge tone="red">Emergency</Badge>}
        </div>
      </div>

      {r.emergency && status === "DEPLOYED" && !r.decidedBy && (
        <Callout tone="warn" icon={Siren}>
          This emergency release went live before approval. A manager other than the author must approve or reject it now.
        </Callout>
      )}
      {status === "DEPLOYED" && r.decision === "REJECTED" && (
        <Callout tone="bad" icon={ShieldAlert}>
          Rejected after it went live. Roll it back, then record the rollback below.
        </Callout>
      )}

      <Card title="The change">
        <dl className="space-y-4">
          <Text label="What changes">{r.changeSummary}</Text>
          <Text label="Why">{r.reason}</Text>
          <Text label="How it was tested">{r.testEvidence}</Text>
          <Text label="How to undo it">{r.rollbackPlan}</Text>
        </dl>
        {can.edit && (
          <Disclosure summary="Edit draft" className="mt-4">
            <ReleaseForm
              action={updateReleaseAction.bind(null, r.id)}
              submitLabel="Save draft"
              defaults={{
                title: r.title,
                versionLabel: r.versionLabel ?? "",
                changeSummary: r.changeSummary,
                reason: r.reason,
                securityImpact: r.securityImpact as Impact,
                testEvidence: r.testEvidence,
                rollbackPlan: r.rollbackPlan,
                emergency: r.emergency,
              }}
            />
          </Disclosure>
        )}
      </Card>

      <Card title="Steps" description="The security check, approval and deployment are done by someone other than the author. Every step is recorded with the name and time.">
        <ol className="space-y-5">
          <Step done title="Written" who={people.author?.name} at={r.createdAt} />
          <Step done={!!r.submittedAt} title="Submitted for approval" who={people.submittedBy?.name} at={r.submittedAt}>
            {can.submit && <StepForm action={submitReleaseAction.bind(null, r.id)} label="Submit for approval" />}
            {can.withdraw && <StepForm action={withdrawReleaseAction.bind(null, r.id)} label="Take back to draft" variant="secondary" />}
          </Step>
          <Step
            done={!!r.securityReviewedAt}
            title={r.securityImpact === "HIGH" ? "Security check (needed: high impact)" : "Security check (optional)"}
            who={people.securityReviewedBy?.name}
            at={r.securityReviewedAt}
            note={r.securityNote}
          >
            {can.securityCheck && (
              <StepForm
                action={securityReviewAction.bind(null, r.id)}
                label="Record security check"
                noteLabel="What you checked"
                required
                placeholder="e.g. Reviewed the refund endpoint: amounts come from the server, permissions checked, no secrets in logs"
              />
            )}
            {!can.securityCheck && blocked.securityCheck && awaiting && !r.securityReviewedAt && <p className="text-xs text-muted">{blocked.securityCheck}</p>}
          </Step>
          <Step
            done={!!r.decidedAt}
            title={r.decision === "REJECTED" ? "Rejected" : r.decision === "APPROVED" ? "Approved" : "Approval by a manager"}
            who={people.decidedBy?.name}
            at={r.decidedAt}
            note={r.decisionNote}
          >
            {can.decide && <DecideForm action={decideReleaseAction.bind(null, r.id)} canApprove={!(r.securityImpact === "HIGH" && !r.securityReviewedAt)} />}
            {awaiting && blocked.decide && <p className="text-xs text-muted">{blocked.decide}</p>}
          </Step>
          <Step done={!!r.deployedAt} title={r.emergency && !r.decidedAt && r.deployedAt ? "Deployed (emergency, before approval)" : "Deployed"} who={people.deployedBy?.name} at={r.deployedAt} note={r.deployNote}>
            {can.deploy && (
              <StepForm
                action={deployReleaseAction.bind(null, r.id)}
                label={status === "SUBMITTED" ? "Deploy now (emergency)" : "Mark as deployed"}
                noteLabel={status === "SUBMITTED" ? "Why it can't wait for approval" : "Note (optional)"}
                required={status === "SUBMITTED"}
                variant={status === "SUBMITTED" ? "danger" : "primary"}
                confirmMessage={status === "SUBMITTED" ? "Deploy before approval? Managers will be told and must approve it afterwards." : undefined}
              />
            )}
            {(status === "APPROVED" || (status === "SUBMITTED" && r.emergency)) && blocked.deploy && <p className="text-xs text-muted">{blocked.deploy}</p>}
          </Step>
          {(status === "DEPLOYED" || status === "ROLLED_BACK") && (
            <Step done={!!r.rolledBackAt} title={r.rolledBackAt ? "Rolled back" : "Rollback (only if something goes wrong)"} who={people.rolledBackBy?.name} at={r.rolledBackAt} note={r.rollbackNote}>
              {can.rollBack && (
                <Disclosure summary="Record a rollback">
                  <StepForm action={rollBackReleaseAction.bind(null, r.id)} label="Record rollback" noteLabel="What went wrong" required variant="danger" />
                </Disclosure>
              )}
            </Step>
          )}
        </ol>
      </Card>
    </div>
  );
}
