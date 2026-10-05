import { FULL_BASIS_POINTS } from "@/lib/money";

// Compensation calculation (design doc section 7). Pure and deterministic: the same plan always
// produces the same amounts, so the Phase 3 approval snapshot reproduces this preview exactly.

export const CALCULATION_VERSION = 1;

export type SplitMode = "PERCENTAGE" | "FIXED_AMOUNT";

export type PlanLine = {
  assignmentId: string;
  memberId: string;
  roleOnProject: string;
  splitType: SplitMode;
  splitBasisPoints: number | null;
  splitAmountMinor: number | null;
};

export type PlanInput = {
  totalValueMinor: number;
  currency: string;
  splitMode: SplitMode;
  /** Active assignments only, in display order. */
  lines: PlanLine[];
};

export type CalculatedLine = PlanLine & {
  amountMinor: number;
  /** Pesewas added to this line from the rounding remainder. */
  roundingAdjustmentMinor: number;
};

export type PlanResult = {
  valid: boolean;
  errors: string[];
  lines: CalculatedLine[];
  allocatedMinor: number;
  unallocatedMinor: number;
  roundingNote: string | null;
};

const SUPPORTED_CURRENCIES = new Set(["GHS"]);

export function calculateCompensation(plan: PlanInput): PlanResult {
  const errors: string[] = [];

  if (!SUPPORTED_CURRENCIES.has(plan.currency)) {
    errors.push(`Currency ${plan.currency} is not supported (MVP is GHS only).`);
  }
  if (!Number.isSafeInteger(plan.totalValueMinor) || plan.totalValueMinor < 0) {
    errors.push("Project value must be a non-negative amount.");
  }
  if (plan.lines.length === 0) errors.push("Add at least one team member to the compensation plan.");

  const seen = new Set<string>();
  for (const line of plan.lines) {
    const key = `${line.memberId}:${line.roleOnProject.trim().toLowerCase()}`;
    if (seen.has(key)) errors.push("The same member appears twice with the same project role.");
    seen.add(key);

    if (line.splitType !== plan.splitMode) {
      errors.push(
        `All splits must use the project's mode (${plan.splitMode === "PERCENTAGE" ? "percentage" : "fixed amount"}).`,
      );
    } else if (line.splitType === "PERCENTAGE") {
      if (line.splitBasisPoints === null || line.splitBasisPoints < 0 || line.splitBasisPoints > FULL_BASIS_POINTS) {
        errors.push("Each percentage must be between 0% and 100%.");
      }
    } else if (line.splitAmountMinor === null || line.splitAmountMinor < 0) {
      errors.push("Each fixed amount must be zero or more.");
    }
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) {
    return { valid: false, errors: uniqueErrors, lines: [], allocatedMinor: 0, unallocatedMinor: 0, roundingNote: null };
  }

  return plan.splitMode === "PERCENTAGE" ? calculatePercentage(plan) : calculateFixed(plan);
}

function calculatePercentage(plan: PlanInput): PlanResult {
  const totalBasisPoints = plan.lines.reduce((sum, line) => sum + (line.splitBasisPoints ?? 0), 0);
  const errors =
    totalBasisPoints === FULL_BASIS_POINTS
      ? []
      : [`Percentages must total exactly 100% (currently ${(totalBasisPoints / 100).toFixed(2)}%).`];

  // Floor each share with integer arithmetic, then give the remainder (always fewer pesewas than
  // there are lines) to the largest share; ties go to the line listed first.
  const total = BigInt(plan.totalValueMinor);
  const lines: CalculatedLine[] = plan.lines.map((line) => ({
    ...line,
    amountMinor: Number((total * BigInt(line.splitBasisPoints ?? 0)) / BigInt(FULL_BASIS_POINTS)),
    roundingAdjustmentMinor: 0,
  }));

  let roundingNote: string | null = null;
  if (errors.length === 0) {
    const floored = lines.reduce((sum, line) => sum + line.amountMinor, 0);
    const remainder = plan.totalValueMinor - floored;
    if (remainder > 0) {
      const largest = lines.reduce(
        (best, line, index) => ((line.splitBasisPoints ?? 0) > (lines[best].splitBasisPoints ?? 0) ? index : best),
        0,
      );
      lines[largest].amountMinor += remainder;
      lines[largest].roundingAdjustmentMinor = remainder;
      roundingNote = `${remainder} pesewa${remainder === 1 ? "" : "s"} left over from rounding added to the largest share.`;
    }
  }

  const allocatedMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  return {
    valid: errors.length === 0,
    errors,
    lines,
    allocatedMinor,
    unallocatedMinor: plan.totalValueMinor - allocatedMinor,
    roundingNote,
  };
}

function calculateFixed(plan: PlanInput): PlanResult {
  const lines: CalculatedLine[] = plan.lines.map((line) => ({
    ...line,
    amountMinor: line.splitAmountMinor ?? 0,
    roundingAdjustmentMinor: 0,
  }));
  const allocatedMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const errors =
    allocatedMinor > plan.totalValueMinor ? ["Fixed amounts add up to more than the project value."] : [];
  return {
    valid: errors.length === 0,
    errors,
    lines,
    allocatedMinor,
    // Shown explicitly in the preview: it must not silently disappear (design doc section 7).
    unallocatedMinor: plan.totalValueMinor - allocatedMinor,
    roundingNote: null,
  };
}
