-- CreateEnum
CREATE TYPE "ViewingProposalParty" AS ENUM ('CUSTOMER', 'LISTING_TEAM');

-- CreateEnum
CREATE TYPE "ViewingProposalStatus" AS ENUM ('OPEN', 'ACCEPTED', 'SUPERSEDED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "ViewingProposal" (
    "id" UUID NOT NULL,
    "viewingRequestId" UUID NOT NULL,
    "proposedBy" "ViewingProposalParty" NOT NULL,
    "actorUserId" UUID,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ViewingProposalStatus" NOT NULL DEFAULT 'OPEN',
    "sourceMessageId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewingProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewingProposal_viewingRequestId_sourceMessageId_key" ON "ViewingProposal"("viewingRequestId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "ViewingProposal_viewingRequestId_status_createdAt_idx" ON "ViewingProposal"("viewingRequestId", "status", "createdAt");

-- At most one open proposal per viewing.
CREATE UNIQUE INDEX "ViewingProposal_one_open_per_viewing" ON "ViewingProposal"("viewingRequestId") WHERE "status" = 'OPEN';

-- AddForeignKey
ALTER TABLE "ViewingProposal" ADD CONSTRAINT "ViewingProposal_viewingRequestId_fkey" FOREIGN KEY ("viewingRequestId") REFERENCES "ViewingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
