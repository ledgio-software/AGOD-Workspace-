-- Rules for Phase 36 (community chat and feedback threads). Like the other community tables: no
-- app-role access; the server reads and writes them after its own checks. Seeds the starting
-- channels and copies existing single replies to feedback into the new reply threads.

REVOKE ALL ON showcase_review_replies, chat_channels, chat_messages, chat_reactions, chat_reads FROM agod_app;
--> statement-breakpoint
ALTER TABLE showcase_review_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_parent_fk FOREIGN KEY (parent_id) REFERENCES chat_messages(id) ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO chat_channels (slug, name, description, kind, position) VALUES
  ('general', 'general', 'Say hello, share news and talk about building in Ghana.', 'CHAT', 0),
  ('help', 'help', 'Stuck? Ask a question: someone will answer. Mark it solved when it is.', 'QUESTIONS', 1),
  ('ai-tools', 'ai-tools', 'Claude, Cursor, Lovable, prompts and what works.', 'CHAT', 2),
  ('show-and-tell', 'show-and-tell', 'Share what you are building, before it is ready for the showcase.', 'CHAT', 3),
  ('jobs-and-gigs', 'jobs-and-gigs', 'Talk about work: leads, rates, clients. Post jobs on the Jobs page.', 'CHAT', 4),
  ('off-topic', 'off-topic', 'Anything else (be kind).', 'CHAT', 5);
--> statement-breakpoint
INSERT INTO showcase_review_replies (review_id, author_id, body, created_at)
  SELECT r.id, p.author_id, r.author_reply, r.replied_at
  FROM showcase_reviews r JOIN showcase_posts p ON p.id = r.post_id
  WHERE r.author_reply IS NOT NULL;
