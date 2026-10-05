import { parseMoney } from "@/lib/money";

// Pilot reconciliation (design doc section 12, Phase 5): compare the team's existing spreadsheet
// with the ledger, line by line.

export type SheetRow = { line: number; projectCode: string; email: string; expectedOwedMinor: number; expectedPaidMinor: number | null };
export type SystemRow = { projectCode: string; email: string; memberName: string; owedMinor: number; paidMinor: number };

export type ReconcileResult = {
  errors: string[];
  matched: { key: string; memberName: string; owedMinor: number; paidMinor: number }[];
  mismatched: { key: string; memberName: string; line: number; expectedOwedMinor: number; owedMinor: number; expectedPaidMinor: number | null; paidMinor: number }[];
  missingInSystem: SheetRow[];
  missingInSheet: SystemRow[];
};

const HEADER = ["project_code", "recipient_email", "expected_owed", "expected_paid"];

function splitLine(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : line.includes(";") && !line.includes(",") ? ";" : ",";
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

/** Parses pasted spreadsheet text with header: project_code, recipient_email, expected_owed[, expected_paid]. */
export function parseSheet(text: string): { rows: SheetRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], errors: ["Paste at least a header row and one data row."] };
  const header = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const idx = HEADER.map((h) => header.indexOf(h));
  if (idx[0] < 0 || idx[1] < 0 || idx[2] < 0) {
    return { rows: [], errors: [`The first row must contain the columns: ${HEADER.join(", ")} (expected_paid optional).`] };
  }
  const rows: SheetRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2;
    const cells = splitLine(raw);
    const owed = parseMoney(cells[idx[2]] ?? "");
    const paidCell = idx[3] >= 0 ? (cells[idx[3]] ?? "") : "";
    const paid = paidCell === "" ? null : parseMoney(paidCell);
    const projectCode = (cells[idx[0]] ?? "").toUpperCase();
    const email = (cells[idx[1]] ?? "").toLowerCase();
    if (!projectCode || !email) return errors.push(`Line ${line}: project code and email are required.`);
    if (owed === null) return errors.push(`Line ${line}: expected_owed "${cells[idx[2]]}" is not an amount like 1250.00.`);
    if (paidCell !== "" && paid === null) return errors.push(`Line ${line}: expected_paid "${paidCell}" is not an amount.`);
    rows.push({ line, projectCode, email, expectedOwedMinor: owed, expectedPaidMinor: paid });
  });
  return { rows, errors };
}

export function reconcile(sheet: SheetRow[], system: SystemRow[]): Omit<ReconcileResult, "errors"> {
  const key = (code: string, email: string) => `${code} / ${email}`;
  // A member can have several lines on one project (different roles): compare per member and project.
  const systemByKey = new Map<string, SystemRow>();
  for (const row of system) {
    const k = key(row.projectCode, row.email);
    const existing = systemByKey.get(k);
    systemByKey.set(k, existing ? { ...existing, owedMinor: existing.owedMinor + row.owedMinor, paidMinor: existing.paidMinor + row.paidMinor } : { ...row });
  }
  const seen = new Set<string>();
  const result: Omit<ReconcileResult, "errors"> = { matched: [], mismatched: [], missingInSystem: [], missingInSheet: [] };
  for (const row of sheet) {
    const k = key(row.projectCode, row.email);
    const sys = systemByKey.get(k);
    if (!sys) {
      result.missingInSystem.push(row);
      continue;
    }
    seen.add(k);
    const paidOk = row.expectedPaidMinor === null || row.expectedPaidMinor === sys.paidMinor;
    if (row.expectedOwedMinor === sys.owedMinor && paidOk) {
      result.matched.push({ key: k, memberName: sys.memberName, owedMinor: sys.owedMinor, paidMinor: sys.paidMinor });
    } else {
      result.mismatched.push({
        key: k,
        memberName: sys.memberName,
        line: row.line,
        expectedOwedMinor: row.expectedOwedMinor,
        owedMinor: sys.owedMinor,
        expectedPaidMinor: row.expectedPaidMinor,
        paidMinor: sys.paidMinor,
      });
    }
  }
  for (const [k, sys] of systemByKey) if (!seen.has(k)) result.missingInSheet.push(sys);
  return result;
}
