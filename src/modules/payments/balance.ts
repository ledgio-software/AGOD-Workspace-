// Payout balance and status are always derived from the ledger entry, its adjustments and its
// payments (design doc 2.3, 6.2). Nobody sets "paid" by hand.

export type AdjustmentType = "INCREASE" | "DECREASE" | "WRITE_OFF" | "VOID";
export type PayoutStatus = "OWED" | "PARTIALLY_PAID" | "PAID" | "DISPUTED" | "VOIDED";

export type BalanceInput = {
  amountOwedMinor: number;
  /** Set when the entry was voided by reopening the project. */
  voided: boolean;
  adjustments: { type: AdjustmentType; amountMinor: number }[];
  payments: { amountMinor: number }[];
};

export type Balance = {
  originalMinor: number;
  /** Net effect of increases, decreases and write-offs. */
  adjustmentsMinor: number;
  effectiveOwedMinor: number;
  paidMinor: number;
  remainingMinor: number;
  status: PayoutStatus;
};

export function payoutBalance(input: BalanceInput): Balance {
  const adjustmentsMinor = input.adjustments.reduce(
    (sum, a) => sum + (a.type === "INCREASE" ? a.amountMinor : a.type === "VOID" ? 0 : -a.amountMinor),
    0,
  );
  const effectiveOwedMinor = input.amountOwedMinor + adjustmentsMinor;
  const paidMinor = input.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const voided = input.voided || input.adjustments.some((a) => a.type === "VOID");
  const remainingMinor = voided ? 0 : effectiveOwedMinor - paidMinor;

  const status: PayoutStatus = voided
    ? "VOIDED"
    : remainingMinor <= 0
      ? "PAID"
      : paidMinor > 0
        ? "PARTIALLY_PAID"
        : "OWED";

  return {
    originalMinor: input.amountOwedMinor,
    adjustmentsMinor,
    effectiveOwedMinor,
    paidMinor,
    remainingMinor,
    status,
  };
}
