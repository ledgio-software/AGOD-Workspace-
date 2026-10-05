import { AccessDenied } from "@/components/access-denied";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listActiveMembers } from "@/modules/projects";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../project-form";

export default async function NewProjectPage() {
  const actor = await requireUser();
  if (!can(actor, "project.create")) return <AccessDenied what="creating projects" />;
  const members = await listActiveMembers(actor);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New project</h1>
        <p className="text-sm text-zinc-500">
          The project starts as a draft. Add the team, splits and tasks next. A project code is assigned automatically.
        </p>
      </div>
      <ProjectForm action={createProjectAction} members={members} defaults={{ projectOwnerId: actor.id }} submitLabel="Create project" />
    </div>
  );
}
