import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Code of conduct" };

// Phase 25: the community rules, from the community handbook.

const rules = [
  ["Be respectful.", "Critique the work, never the person."],
  ["No gatekeeping.", "Vibe coding and traditional coding are both welcome here. Nobody is looked down on for how they build."],
  ["Show your work.", "Posts with a link, screenshot or repository get better feedback."],
  ["Never share secrets.", "Remove API keys, passwords and personal data before posting code or screenshots."],
  ["Credit others.", "If you used someone's code, template or idea, say so."],
  ["No spam or scams.", "Promote your own work only where it belongs (launches and the showcase), once per launch or major update."],
  ["Give back.", "Review at least one project for every one you post."],
] as const;

const feedback = [
  "Start with what works.",
  "Name one or two specific problems, not ten.",
  "Suggest a next step the person can take today.",
  "For AI-built projects, check the basics: exposed keys, missing input checks, no login protection on private pages.",
];

export default function CodeOfConductPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Code of conduct</h1>
        <p className="text-sm text-muted">
          {PRODUCT_NAME} is a place to build, share ideas and get honest, kind feedback. These rules keep it that way.
        </p>
      </div>
      <Card title="Community rules">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {rules.map(([title, text]) => (
            <li key={title}>
              <span className="font-medium">{title}</span> {text}
            </li>
          ))}
        </ol>
      </Card>
      <Card title="How to give good feedback">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {feedback.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Card>
      <Card title="If something is wrong">
        <div className="space-y-2 text-sm">
          <p>
            Use <span className="font-medium">Report</span> on the profile (signed-in members). The organizers see who reported it and why; the member doesn&apos;t.
          </p>
          <p>
            Organizers look at every report. When a rule was broken they hide the profile and note why; otherwise they close the report. Spam and scams are
            removed quickly.
          </p>
        </div>
      </Card>
    </div>
  );
}
