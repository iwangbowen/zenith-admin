-- Custom SQL migration file, put your code below! --
-- 清理历史「机器人假用户」zenith-assistant 及其单聊会话（幂等，可重复执行）。
-- 背景：旧实现用 users 表里的 isBot 假用户充当系统消息发送者，已被 Channel（站内公众号）取代；
-- DROP COLUMN is_bot 只删列不删行，此处补删残留数据行，避免其继续出现在用户管理列表中。
DELETE FROM "chat_conversations" WHERE "id" IN (
	SELECT "conversation_id" FROM "chat_conversation_members" WHERE "user_id" IN (
		SELECT "id" FROM "users" WHERE "username" = 'zenith-assistant'
	)
);
--> statement-breakpoint
DELETE FROM "users" WHERE "username" = 'zenith-assistant';