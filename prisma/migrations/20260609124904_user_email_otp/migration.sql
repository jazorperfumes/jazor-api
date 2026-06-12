-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "emailOtpHash" TEXT;
