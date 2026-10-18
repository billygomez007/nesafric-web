-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "whatsappAssignmentId" UUID;

-- CreateIndex
CREATE INDEX "Conversation_whatsappAssignmentId_idx" ON "Conversation"("whatsappAssignmentId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_whatsappAssignmentId_fkey" FOREIGN KEY ("whatsappAssignmentId") REFERENCES "WhatsAppNumberAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

