import type { PlanResult } from "@/modules/compensation/calculate";
import type { TaskStatus } from "@/modules/projects/rules";

export type ReadinessTask = { id: string; title: string; status: TaskStatus; required: boolean };

export type Readiness = {
  /** True when nothing blocks approval at all. */
  ready: boolean;
  /** Problems that no approver can override (design doc 2.5). */
  blockers: string[];
  /** Required tasks neither done nor waived; approvable only with an override reason. */
  incompleteTasks: ReadinessTask[];
};

/**
 * A project can be approved when the compensation plan is valid and every required task is done
 * or explicitly waived. Incomplete tasks can be overridden by the approver with a recorded reason.
 */
export function approvalReadiness(plan: PlanResult, tasks: ReadinessTask[]): Readiness {
  const blockers = plan.valid ? [] : plan.errors.map((e) => `Compensation plan: ${e}`);
  const incompleteTasks = tasks.filter((t) => t.required && t.status !== "DONE" && t.status !== "WAIVED");
  return { ready: blockers.length === 0 && incompleteTasks.length === 0, blockers, incompleteTasks };
}
