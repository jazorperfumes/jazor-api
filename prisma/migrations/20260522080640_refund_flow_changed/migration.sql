-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('PRE_SHIP_CANCEL', 'DAMAGE_CLAIM');

-- CreateEnum
CREATE TYPE "RefundReasonCode" AS ENUM ('DAMAGED_BOTTLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RefundStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "RefundStatus" ADD VALUE 'REJECTED';
ALTER TYPE "RefundStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "kind" "RefundKind" NOT NULL DEFAULT 'PRE_SHIP_CANCEL',
ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "reasonCode" "RefundReasonCode",
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "userDescription" TEXT,
ALTER COLUMN "status" DROP DEFAULT;

-- CreateTable
CREATE TABLE "RefundImage" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundImage_refundId_idx" ON "RefundImage"("refundId");

-- CreateIndex
CREATE INDEX "Refund_orderItemId_idx" ON "Refund"("orderItemId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundImage" ADD CONSTRAINT "RefundImage_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
