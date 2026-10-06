import Link from "next/link";
import { ImageIcon, MessageSquareText, Sparkles } from "lucide-react";
import { Badge } from "@/components/badges";
import { STATUS_LABEL, STATUS_TONE } from "@/modules/community/showcase-labels";

export type CardData = {
  id: string;
  title: string;
  pitch: string;
  builtWith: string[];
  aiBuilt: boolean;
  status: string;
  authorName: string;
  reviews: number;
  /** Screenshot URL (a stored one, or a local preview). */
  image: string | null;
};

/** A project in the showcase grid, and the live preview on the post form. */
export function PostCardView({ post, href }: { post: CardData; href?: string }) {
  const body = (
    <>
      <div className="aspect-[16/9] overflow-hidden rounded-t-xl bg-surface-muted">
        {post.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.image} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-muted">
            <ImageIcon className="size-8 opacity-40" aria-hidden />
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[post.status as keyof typeof STATUS_TONE] ?? "gray"}>{STATUS_LABEL[post.status as keyof typeof STATUS_LABEL] ?? post.status}</Badge>
          {post.aiBuilt && (
            <Badge tone="violet">
              <Sparkles className="mr-0.5 inline size-3" aria-hidden />
              AI-built
            </Badge>
          )}
        </div>
        <p className="line-clamp-1 font-semibold text-fg">{post.title || "Your project's name"}</p>
        <p className="line-clamp-2 text-sm text-muted">{post.pitch || "What it does, in one sentence."}</p>
        {post.builtWith.length > 0 && <p className="truncate text-xs text-muted">{post.builtWith.slice(0, 5).join(" · ")}</p>}
        <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted">
          <span className="truncate">by {post.authorName}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <MessageSquareText className="size-3.5" aria-hidden /> {post.reviews}
          </span>
        </div>
      </div>
    </>
  );
  const cls = "flex h-full flex-col rounded-xl border border-line bg-surface shadow-xs";
  return href ? (
    <Link href={href} className={`${cls} transition hover:border-brand-300 hover:shadow-sm`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
