-- Reuse conversations/messages as the durable inbox and workflow store.
ALTER TABLE "Conversation" ADD COLUMN "whatsappSessionKey" TEXT, ADD COLUMN "assistantState" JSONB;
CREATE UNIQUE INDEX "Conversation_whatsappSessionKey_key" ON "Conversation"("whatsappSessionKey");
ALTER TABLE "Message" ADD COLUMN "processedAt" TIMESTAMP(3);
CREATE INDEX "Message_conversationId_direction_processedAt_createdAt_idx" ON "Message"("conversationId", "direction", "processedAt", "createdAt");
CREATE INDEX "MessageDelivery_organisationId_channel_providerReference_idx" ON "MessageDelivery"("organisationId", "channel", "providerReference");
