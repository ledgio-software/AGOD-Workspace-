"use client";

import { useActionState } from "react";
import { FormMessage, inputClass } from "@/components/form";
import { formatMoney } from "@/lib/money";
import { reconcileAction } from "./actions";

const example = `project_code,recipient_email,expected_owed,expected_paid
AGOD-2026-001,ama@example.com,1250.01,500.00
AGOD-2026-001,kofi@example.com,1250.00,`;

export function ReconcileForm() {
  const [state, action, pending] = useActionState(reconcileAction, null);
  const r = state?.ok ? state.data : null;

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Paste rows from your spreadsheet (CSV, or copy cells straight from Excel/Google Sheets)</span>
          <textarea name="sheet" required rows={10} placeholder={example} className={`${inputClass} font-mono`} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Comparing…" : "Compare with the ledger"}
        </button>
        <FormMessage state={state && !state.ok ? state : null} />
      </form>

      {r && (
        <div className="space-y-4 text-sm">
          <p className={r.mismatched.length + r.missingInSystem.length + r.missingInSheet.length + r.errors.length === 0 ? "text-green-700" : ""}>
            <strong>{r.matched.length}</strong> match · <strong>{r.mismatched.length}</strong> differ ·{" "}
            <strong>{r.missingInSystem.length}</strong> only in the spreadsheet · <strong>{r.missingInSheet.length}</strong> only in the
            system{r.errors.length > 0 && <> · <strong>{r.errors.length}</strong> unreadable lines</>}
          </p>
          {r.errors.length > 0 && (
            <ul className="list-disc pl-5 text-red-600">
              {r.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {r.mismatched.length > 0 && (
            <div>
              <h3 className="font-semibold">Differences</h3>
              <table className="w-full text-left">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Project / recipient</th>
                    <th className="py-1 pr-3 font-medium">Owed: sheet → system</th>
                    <th className="py-1 font-medium">Paid: sheet → system</th>
                  </tr>
                </thead>
                <tbody>
                  {r.mismatched.map((m) => (
                    <tr key={m.key} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="py-1 pr-3">
                        {m.key} ({m.memberName}) · sheet line {m.line}
                      </td>
                      <td className={`py-1 pr-3 tabular-nums ${m.expectedOwedMinor !== m.owedMinor ? "text-red-600" : ""}`}>
                        {formatMoney(m.expectedOwedMinor)} → {formatMoney(m.owedMinor)}
                      </td>
                      <td
                        className={`py-1 tabular-nums ${m.expectedPaidMinor !== null && m.expectedPaidMinor !== m.paidMinor ? "text-red-600" : ""}`}
                      >
                        {m.expectedPaidMinor === null ? "—" : formatMoney(m.expectedPaidMinor)} → {formatMoney(m.paidMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.missingInSystem.length > 0 && (
            <div>
              <h3 className="font-semibold">Only in the spreadsheet</h3>
              <ul className="list-disc pl-5">
                {r.missingInSystem.map((m) => (
                  <li key={m.line}>
                    Line {m.line}: {m.projectCode} / {m.email}, owed {formatMoney(m.expectedOwedMinor)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.missingInSheet.length > 0 && (
            <div>
              <h3 className="font-semibold">Only in the system</h3>
              <ul className="list-disc pl-5">
                {r.missingInSheet.map((m) => (
                  <li key={`${m.projectCode}-${m.email}`}>
                    {m.projectCode} / {m.email} ({m.memberName}), owed {formatMoney(m.owedMinor)}, paid {formatMoney(m.paidMinor)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.matched.length > 0 && (
            <details>
              <summary className="cursor-pointer text-zinc-500">{r.matched.length} matching line(s)</summary>
              <ul className="list-disc pl-5">
                {r.matched.map((m) => (
                  <li key={m.key}>
                    {m.key} ({m.memberName}): owed {formatMoney(m.owedMinor)}, paid {formatMoney(m.paidMinor)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
