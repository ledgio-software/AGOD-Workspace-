import { describe, expect, it } from "vitest";
import { findTaskKeys, linkKey, normaliseRepo, parseGithubUrl, suggestedBranch, taskKey } from "./refs";

describe("task keys", () => {
  it("formats and finds keys in branch names, titles and bodies", () => {
    expect(taskKey("AGOD-2026-005", 3)).toBe("AGOD-2026-005-T3");
    expect(
      findTaskKeys("backend/AGOD-2026-005-T3-payslip-api", "Fix agod-2026-005-t3 and AGOD-2026-007-T12", null, "AGOD-2026-005-T3x"),
    ).toEqual([
      { projectCode: "AGOD-2026-005", number: 3 },
      { projectCode: "AGOD-2026-007", number: 12 },
    ]);
    expect(findTaskKeys("TOOLONGPRE-2026-005-T3", "AGOD-2026-05-T3", "1AB-2026-005-T3")).toEqual([]);
    // Other companies' prefixes (Phase 22).
    expect(findTaskKeys("feature/ACME-2026-001-T2-login")).toEqual([{ projectCode: "ACME-2026-001", number: 2 }]);
  });

  it("suggests a branch name", () => {
    expect(suggestedBranch("backend", "AGOD-2026-005-T3", "Payslip API: 2026 tax bands!")).toBe("backend/AGOD-2026-005-T3-payslip-api-2026-tax-bands");
    expect(suggestedBranch("frontend", "AGOD-2026-005-T4", "!!!")).toBe("frontend/AGOD-2026-005-T4");
  });
});

describe("parseGithubUrl", () => {
  it("recognises issues, pull requests, commits and branches", () => {
    expect(parseGithubUrl("https://github.com/Acme-Co/App/pull/12/files")).toEqual({
      kind: "PULL_REQUEST",
      repo: "acme-co/app",
      number: 12,
      url: "https://github.com/acme-co/app/pull/12",
    });
    expect(parseGithubUrl("https://github.com/agod/app/issues/7#issuecomment-1")).toMatchObject({ kind: "ISSUE", number: 7 });
    expect(parseGithubUrl("https://github.com/agod/app/commit/ABCDEF1234")).toMatchObject({ kind: "COMMIT", ref: "abcdef1234" });
    expect(parseGithubUrl("https://github.com/agod/app/tree/backend/AGOD-2026-005-T3-api")).toMatchObject({
      kind: "BRANCH",
      ref: "backend/AGOD-2026-005-T3-api",
    });
  });

  it("rejects other hosts, plain http and unknown paths", () => {
    expect(parseGithubUrl("https://gitlab.com/agod/app/issues/7")).toBeNull();
    expect(parseGithubUrl("http://github.com/agod/app/issues/7")).toBeNull();
    expect(parseGithubUrl("https://github.com/agod/app")).toBeNull();
    expect(parseGithubUrl("not a url")).toBeNull();
  });

  it("builds a unique key per linked item", () => {
    expect(linkKey(parseGithubUrl("https://github.com/agod/app/pull/12")!)).toBe("PULL_REQUEST:agod/app#12");
    expect(linkKey(parseGithubUrl("https://github.com/agod/app/tree/main")!)).toBe("BRANCH:agod/app@main");
  });
});

describe("normaliseRepo", () => {
  it("accepts owner/name or a repository URL", () => {
    expect(normaliseRepo(" Acme-Co/Payroll-App ")).toBe("acme-co/payroll-app");
    expect(normaliseRepo("https://github.com/agod/app.git")).toBe("agod/app");
    expect(normaliseRepo("")).toBeNull();
    expect(normaliseRepo("not a repo")).toBeUndefined();
  });
});
