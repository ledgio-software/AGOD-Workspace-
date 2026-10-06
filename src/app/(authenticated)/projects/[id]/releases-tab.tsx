import { Rocket } from "lucide-react";
import { Card, Disclosure, EmptyState } from "@/components/ui";
import type { ReleaseRow } from "@/modules/releases";
import { createReleaseAction } from "@/app/(authenticated)/releases/actions";
import { ReleaseForm } from "@/app/(authenticated)/releases/forms";
import { ReleaseTable } from "@/app/(authenticated)/releases/release-ui";

// Phase 32: the project's releases (change control) and a form to record a new one.

export function ReleasesTab({ projectId, releases, canCreate }: { projectId: string; releases: ReleaseRow[]; canCreate: boolean }) {
  return (
    <div className="space-y-6">
      {canCreate && (
        <Disclosure summary="Record a new release" className="bg-surface">
          <p className="mb-4 text-sm text-muted">
            Before a change goes live, write down what changes, why, how it was tested and how to undo it. You submit it; someone else checks security
            and a manager approves. You can&apos;t approve or deploy your own release.
          </p>
          <ReleaseForm action={createReleaseAction.bind(null, projectId)} submitLabel="Save as draft" />
        </Disclosure>
      )}
      <Card title="Releases" bodyClassName="">
        {releases.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState icon={Rocket} title="No releases yet">
              {canCreate ? "Record the first one above." : "Releases written for this project appear here."}
            </EmptyState>
          </div>
        ) : (
          <ReleaseTable rows={releases} showProject={false} />
        )}
      </Card>
    </div>
  );
}
