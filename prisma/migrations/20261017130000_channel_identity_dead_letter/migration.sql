-- Jobs that exhausted their attempts or failed permanently stop being retried automatically.
ALTER TYPE "BackgroundJobStatus" ADD VALUE 'DEAD_LETTER';

-- A send whose outcome is unknown is never resent automatically.
ALTER TYPE "MessageDeliveryStatus" ADD VALUE 'UNCONFIRMED';

-- Messaging address to verified NesAfric account link, plus opt-out state.
CREATE TYPE "ChannelIdentityVerification" AS ENUM ('SMS_OTP', 'EMAIL_OTP', 'ADMIN');

CREATE TABLE "ChannelIdentity" (
    "id" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "userId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "verificationMethod" "ChannelIdentityVerification",
    "optedOutAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelIdentity_channel_address_key" ON "ChannelIdentity"("channel", "address");
CREATE INDEX "ChannelIdentity_userId_idx" ON "ChannelIdentity"("userId");
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
