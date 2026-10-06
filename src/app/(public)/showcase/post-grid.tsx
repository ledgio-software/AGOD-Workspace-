import type { PostCard } from "@/modules/community/showcase";
import { PostCardView } from "./post-card";

export function PostGrid({ posts, empty = "No projects yet." }: { posts: PostCard[]; empty?: string }) {
  if (posts.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => (
        <li key={p.id}>
          <PostCardView
            href={`/showcase/${p.id}`}
            post={{ ...p, image: p.coverId ? `/showcase/${p.id}/images/${p.coverId}` : null }}
          />
        </li>
      ))}
    </ul>
  );
}
