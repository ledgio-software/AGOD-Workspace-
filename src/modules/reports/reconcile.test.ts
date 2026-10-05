import { describe, expect, it } from "vitest";
import { parseSheet, reconcile } from "./reconcile";

const system = [
  { projectCode: "AGOD-2026-001", email: "ama@agod.test", memberName: "Ama", owedMinor: 125_001, paidMinor: 50_000 },
  { projectCode: "AGOD-2026-001", email: "kofi@agod.test", memberName: "Kofi", owedMinor: 125_000, paidMinor: 0 },
  { projectCode: "AGOD-2026-002", email: "ama@agod.test", memberName: "Ama", owedMinor: 30_000, paidMinor: 30_000 },
];

describe("parseSheet", () => {
  it("reads comma, semicolon or tab separated text with quotes and thousands separators", () => {
    const { rows, errors } = parseSheet(
      'project_code,recipient_email,expected_owed,expected_paid\nagod-2026-001,AMA@agod.test,"1,250.01",500\n',
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ projectCode: "AGOD-2026-001", email: "ama@agod.test", expectedOwedMinor: 125_001, expectedPaidMinor: 50_000 });
    expect(parseSheet("project_code\trecipient_email\texpected_owed\nAGOD-1\ta@b.c\t10").rows).toHaveLength(1);
    expect(parseSheet("project_code;recipient_email;expected_owed\nAGOD-1;a@b.c;10").rows).toHaveLength(1);
  });

  it("explains bad input per line", () => {
    expect(parseSheet("name,amount\nx,1").errors[0]).toMatch(/first row must contain/);
    expect(parseSheet("project_code,recipient_email,expected_owed\nAGOD-1,a@b.c,12.345").errors[0]).toMatch(/Line 2/);
  });
});

describe("reconcile", () => {
  it("sorts every line into matched, mismatched and missing on either side", () => {
    const { rows } = parseSheet(
      [
        "project_code,recipient_email,expected_owed,expected_paid",
        "AGOD-2026-001,ama@agod.test,1250.01,500",
        "AGOD-2026-001,kofi@agod.test,1250.01,",
        "AGOD-2026-009,yaw@agod.test,100,",
      ].join("\n"),
    );
    const r = reconcile(rows, system);
    expect(r.matched.map((m) => m.key)).toEqual(["AGOD-2026-001 / ama@agod.test"]);
    expect(r.mismatched).toMatchObject([{ key: "AGOD-2026-001 / kofi@agod.test", expectedOwedMinor: 125_001, owedMinor: 125_000 }]);
    expect(r.missingInSystem.map((m) => m.projectCode)).toEqual(["AGOD-2026-009"]);
    expect(r.missingInSheet.map((m) => m.projectCode)).toEqual(["AGOD-2026-002"]);
  });

  it("ignores the paid column when it is left empty", () => {
    const { rows } = parseSheet("project_code,recipient_email,expected_owed\nAGOD-2026-002,ama@agod.test,300");
    expect(reconcile(rows, system).matched).toHaveLength(1);
  });
});
