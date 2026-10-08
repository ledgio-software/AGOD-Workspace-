-- Rules for Phase 38 (tech news). Like the other community tables: no app-role access; the server
-- reads and writes them after its own checks (src/modules/community/news.ts).

REVOKE ALL ON news_sources, news_items, news_useful FROM agod_app;
--> statement-breakpoint
ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE news_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE news_useful ENABLE ROW LEVEL SECURITY;
