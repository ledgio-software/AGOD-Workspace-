import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// Shared building blocks for the redesigned pages (Phase 12). Server-safe: no hooks.

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("min-w-0 rounded-xl border border-line bg-surface shadow-xs", className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      <div className={bodyClassName ?? "px-5 py-4"}>{children}</div>
    </section>
  );
}

const toneStyles = {
  default: { icon: "bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300", value: "text-fg" },
  good: { icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300", value: "text-fg" },
  warn: { icon: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300", value: "text-amber-700 dark:text-amber-400" },
  bad: { icon: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300", value: "text-red-600 dark:text-red-400" },
} as const;

export type Tone = keyof typeof toneStyles;

export function StatCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  const styles = toneStyles[tone];
  const body = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted">{label}</div>
        {Icon && (
          <span className={cx("grid size-7 shrink-0 place-items-center rounded-lg", styles.icon)}>
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
      <div className={cx("text-xl font-semibold tracking-tight tabular-nums xl:text-[1.375rem]", styles.value)}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
  const cls = "block min-w-0 rounded-xl border border-line bg-surface p-4 shadow-xs";
  return href ? (
    <Link href={href} className={cx(cls, "transition hover:border-brand-300 hover:shadow-sm dark:hover:border-brand-700")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      {Icon && (
        <span className="grid size-10 place-items-center rounded-full bg-surface-muted text-muted">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <p className="max-w-sm text-xs text-muted">{children}</p>}
    </div>
  );
}

const calloutStyles = {
  info: "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/50 dark:text-brand-100",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  bad: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
} as const;

export function Callout({
  tone = "info",
  icon: Icon,
  children,
  action,
}: {
  tone?: keyof typeof calloutStyles;
  icon?: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={cx("flex items-center gap-3 rounded-xl border px-4 py-3 text-sm", calloutStyles[tone])}>
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

const buttonStyles = {
  primary: "bg-brand-600 text-white shadow-xs hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400",
  secondary: "border border-line-strong bg-surface text-fg shadow-xs hover:bg-surface-muted",
  ghost: "text-muted hover:bg-surface-muted hover:text-fg",
  danger: "bg-red-600 text-white shadow-xs hover:bg-red-700",
} as const;

export type ButtonVariant = keyof typeof buttonStyles;

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
    buttonStyles[variant],
  );
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "md",
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}

/** Rows for simple label/value lists inside cards. */
export function ListRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <li className={cx("flex items-center justify-between gap-3 py-2.5 text-sm", className)}>{children}</li>;
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="-my-2.5 divide-y divide-line">{children}</ul>;
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
      )}
    >
      {initials || "?"}
    </span>
  );
}

export const table = {
  wrap: "-mx-5 -my-4 overflow-x-auto",
  table: "w-full text-left text-sm",
  head: "border-b border-line bg-surface-muted/60 text-xs uppercase tracking-wide text-muted",
  th: "px-5 py-2.5 font-medium",
  row: "border-b border-line last:border-0 hover:bg-surface-muted/50",
  td: "px-5 py-3 align-middle",
  num: "whitespace-nowrap px-5 py-3 text-right tabular-nums",
};

/** Denser cells for wide money tables. */
export const compactTable = {
  th: "px-3 py-2.5 font-medium first:pl-5 last:pr-5",
  td: "px-3 py-2.5 align-middle first:pl-5 last:pr-5",
  num: "whitespace-nowrap px-3 py-2.5 text-right tabular-nums first:pl-5 last:pr-5",
};

export type TabItem = { href: string; label: string; active: boolean; count?: number; icon?: LucideIcon };

/** Underlined tab links (each tab is its own URL, so it can be shared and survives a reload). */
export function TabNav({ label, items }: { label: string; items: TabItem[] }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map(({ href, label: text, active, count, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition",
                active ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {Icon && <Icon className="size-4" aria-hidden />}
              {text}
              {count !== undefined && count > 0 && <span className="rounded-full bg-surface-muted px-1.5 text-[11px] tabular-nums text-muted">{count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A collapsible block for forms that are only needed now and then. */
export function Disclosure({ summary, children, className }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={cx("group rounded-lg border border-line", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-fg hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        {summary}
        <span className="text-muted transition group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}
