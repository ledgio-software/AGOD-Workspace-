// Plain-text template outlines (roadmap 2.7). One line per item:
//
//   # Design                          a milestone
//   - Wireframes | +10d | 12h         a task: due 10 days after the start, estimated 12 hours
//   - Handover | optional             a task that does not count towards progress
//
// Everything after the title is optional and can come in any order. Tasks before the first
// milestone belong to no milestone. Blank lines are ignored.

export type OutlineTask = { title: string; dueOffsetDays: number | null; estimateHours: number | null; required: boolean };
export type OutlineMilestone = { title: string; tasks: OutlineTask[] };
export type Outline = { looseTasks: OutlineTask[]; milestones: OutlineMilestone[] };

export const OUTLINE_LIMITS = { milestones: 30, tasks: 200, titleLength: 200 } as const;

export function parseOutline(text: string): { outline: Outline; errors: string[] } {
  const outline: Outline = { looseTasks: [], milestones: [] };
  const errors: string[] = [];
  let taskCount = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const where = `Line ${index + 1}`;
    if (!line) return;
    if (line.startsWith("#")) {
      const title = line.replace(/^#+/, "").trim();
      if (title.length < 2) errors.push(`${where}: a milestone needs a title.`);
      else outline.milestones.push({ title: title.slice(0, OUTLINE_LIMITS.titleLength), tasks: [] });
      return;
    }
    if (!/^[-*]/.test(line)) {
      errors.push(`${where}: start with "# " for a milestone or "- " for a task.`);
      return;
    }
    const [titlePart, ...parts] = line.replace(/^[-*]\s*/, "").split("|").map((p) => p.trim());
    if (titlePart.length < 2) {
      errors.push(`${where}: a task needs a title.`);
      return;
    }
    const task: OutlineTask = { title: titlePart.slice(0, OUTLINE_LIMITS.titleLength), dueOffsetDays: null, estimateHours: null, required: true };
    for (const part of parts) {
      const due = /^\+?(\d{1,3})\s*d(ays?)?$/i.exec(part);
      const hours = /^(\d{1,3})\s*h(ours?)?$/i.exec(part);
      if (due) task.dueOffsetDays = Number(due[1]);
      else if (hours && Number(hours[1]) >= 1) task.estimateHours = Number(hours[1]);
      else if (/^optional$/i.test(part)) task.required = false;
      else if (part) errors.push(`${where}: "${part}" is not understood (use +5d, 8h or optional).`);
    }
    const current = outline.milestones.at(-1);
    (current ? current.tasks : outline.looseTasks).push(task);
    taskCount++;
  });
  if (outline.milestones.length > OUTLINE_LIMITS.milestones) errors.push(`At most ${OUTLINE_LIMITS.milestones} milestones.`);
  if (taskCount > OUTLINE_LIMITS.tasks) errors.push(`At most ${OUTLINE_LIMITS.tasks} tasks.`);
  if (taskCount === 0) errors.push("Add at least one task.");
  return { outline, errors };
}

function formatTask(t: OutlineTask): string {
  const parts = [t.title];
  if (t.dueOffsetDays !== null) parts.push(`+${t.dueOffsetDays}d`);
  if (t.estimateHours !== null) parts.push(`${t.estimateHours}h`);
  if (!t.required) parts.push("optional");
  return `- ${parts.join(" | ")}`;
}

export function formatOutline(outline: Outline): string {
  const lines = outline.looseTasks.map(formatTask);
  for (const m of outline.milestones) lines.push(`# ${m.title}`, ...m.tasks.map(formatTask));
  return lines.join("\n");
}

export function outlineCounts(outline: Outline) {
  return {
    milestones: outline.milestones.length,
    tasks: outline.looseTasks.length + outline.milestones.reduce((s, m) => s + m.tasks.length, 0),
    hours: [...outline.looseTasks, ...outline.milestones.flatMap((m) => m.tasks)].reduce((s, t) => s + (t.estimateHours ?? 0), 0),
  };
}
