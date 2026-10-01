ALTER TABLE "MarketplaceEnquiry"
ADD COLUMN "conversationId" UUID;

CREATE UNIQUE INDEX "MarketplaceEnquiry_conversationId_key"
ON "MarketplaceEnquiry"("conversationId");

ALTER TABLE "MarketplaceEnquiry"
ADD CONSTRAINT "MarketplaceEnquiry_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "Conversation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
