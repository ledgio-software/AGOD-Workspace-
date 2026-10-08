-- Rules for Phase 34 (stickers, voice notes, mentions and reactions in messages). Reactions follow
-- their message: only the people in its conversation see them, and each person adds or removes
-- only their own. Messages stay unchangeable by the app role.

GRANT SELECT, INSERT, DELETE ON message_reactions TO agod_app;
--> statement-breakpoint
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY message_reactions_tenant ON message_reactions AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT TO agod_app
  USING (EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND app_in_conversation(m.conversation_id)));
--> statement-breakpoint
CREATE POLICY message_reactions_insert ON message_reactions FOR INSERT TO agod_app
  WITH CHECK (user_id = app_user_id() AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND app_in_conversation(m.conversation_id)));
--> statement-breakpoint
CREATE POLICY message_reactions_delete ON message_reactions FOR DELETE TO agod_app
  USING (user_id = app_user_id());
--> statement-breakpoint
CREATE TRIGGER message_reactions_same_org BEFORE INSERT OR UPDATE ON message_reactions FOR EACH ROW
  EXECUTE FUNCTION app_same_org('message_id:messages', 'user_id:member');
