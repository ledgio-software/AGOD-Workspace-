-- Rules for Phase 37 (articles). Like the other community tables: no app-role access; the server
-- reads and writes them after its own checks (src/modules/community/articles.ts).

REVOKE ALL ON articles, article_claps, article_bookmarks, article_comments, article_reviews, article_reposts FROM agod_app;
--> statement-breakpoint
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE article_claps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE article_bookmarks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE article_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE article_reposts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE article_comments ADD CONSTRAINT article_comments_parent_fk FOREIGN KEY (parent_id) REFERENCES article_comments(id) ON DELETE RESTRICT;
