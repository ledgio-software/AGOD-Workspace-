-- Rules for Phase 30 (in-app messages). Only the people in a conversation can see it and write
-- in it, whatever their role: Admins can't read other people's messages. Messages are never
-- edited or deleted by the app role. Everyone in a conversation belongs to its company.

GRANT SELECT, INSERT, UPDATE ON conversations, conversation_members TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON messages TO agod_app;
--> statement-breakpoint
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Whether the acting person is in the conversation (and active in its company). SECURITY DEFINER
-- so the membership policies can use it without looking at themselves.
CREATE FUNCTION app_in_conversation(cid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT app_user_role() IS NOT NULL AND EXISTS (
      SELECT 1 FROM conversation_members m
      WHERE m.conversation_id = cid AND m.user_id = app_user_id() AND m.organization_id = app_org_id()
    )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_in_conversation(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_in_conversation(uuid) TO agod_app;
--> statement-breakpoint
CREATE POLICY conversations_tenant ON conversations AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
-- The creator sees the new conversation until their own membership row exists (same transaction).
CREATE POLICY conversations_select ON conversations FOR SELECT TO agod_app
  USING (app_in_conversation(id) OR (created_by = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint
CREATE POLICY conversations_insert ON conversations FOR INSERT TO agod_app
  WITH CHECK (created_by = app_user_id() AND app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY conversations_update ON conversations FOR UPDATE TO agod_app
  USING (app_in_conversation(id)) WITH CHECK (app_in_conversation(id));
--> statement-breakpoint
CREATE POLICY conversation_members_tenant ON conversation_members AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY conversation_members_select ON conversation_members FOR SELECT TO agod_app
  USING (app_in_conversation(conversation_id));
--> statement-breakpoint
-- People are added only by the conversation's creator, when it is started.
CREATE POLICY conversation_members_insert ON conversation_members FOR INSERT TO agod_app
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.created_by = app_user_id()));
--> statement-breakpoint
-- Each person updates only their own read marker.
CREATE POLICY conversation_members_update ON conversation_members FOR UPDATE TO agod_app
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY messages_tenant ON messages AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY messages_select ON messages FOR SELECT TO agod_app USING (app_in_conversation(conversation_id));
--> statement-breakpoint
CREATE POLICY messages_insert ON messages FOR INSERT TO agod_app
  WITH CHECK (author_id = app_user_id() AND app_in_conversation(conversation_id));
--> statement-breakpoint
CREATE TRIGGER conversations_same_org BEFORE INSERT OR UPDATE ON conversations FOR EACH ROW
  EXECUTE FUNCTION app_same_org('created_by:member');
--> statement-breakpoint
CREATE TRIGGER conversation_members_same_org BEFORE INSERT OR UPDATE ON conversation_members FOR EACH ROW
  EXECUTE FUNCTION app_same_org('conversation_id:conversations', 'user_id:member');
--> statement-breakpoint
CREATE TRIGGER messages_same_org BEFORE INSERT OR UPDATE ON messages FOR EACH ROW
  EXECUTE FUNCTION app_same_org('conversation_id:conversations', 'author_id:member');
--> statement-breakpoint
-- Only the read marker of a membership changes; a conversation keeps its creator.
CREATE FUNCTION conversation_members_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.conversation_id <> OLD.conversation_id OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'A conversation membership cannot move' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER conversation_members_guard BEFORE UPDATE ON conversation_members FOR EACH ROW EXECUTE FUNCTION conversation_members_guard();
--> statement-breakpoint
CREATE FUNCTION conversations_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'A conversation keeps its creator' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER conversations_guard BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION conversations_guard();
