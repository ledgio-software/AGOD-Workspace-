import { Lock } from "lucide-react";
import { EmptyState } from "./ui";

export function AccessDenied({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-8 shadow-xs">
      <EmptyState icon={Lock} title="Not available">
        Your role doesn&apos;t give access to {what}. Ask an Admin if you think this is wrong.
      </EmptyState>
    </div>
  );
}
