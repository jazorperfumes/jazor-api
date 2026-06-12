/*
  Warnings:

  - You are about to drop the column `discountId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the `Discount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DiscountRedemption` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PromotionRewardType" AS ENUM ('PERCENT', 'FLAT', 'FREE_SHIPPING', 'BUY_X_GET_Y');

-- CreateEnum
CREATE TYPE "PromotionApplyMode" AS ENUM ('AUTOMATIC', 'CODE');

-- DropForeignKey
ALTER TABLE "DiscountRedemption" DROP CONSTRAINT "DiscountRedemption_discountId_fkey";

-- DropForeignKey
ALTER TABLE "DiscountRedemption" DROP CONSTRAINT "DiscountRedemption_orderId_fkey";

-- DropForeignKey
ALTER TABLE "DiscountRedemption" DROP CONSTRAINT "DiscountRedemption_userId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_discountId_fkey";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "discountId";

-- DropTable
DROP TABLE "Discount";

-- DropTable
DROP TABLE "DiscountRedemption";

-- DropEnum
DROP TYPE "DiscountType";

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rewardType" "PromotionRewardType" NOT NULL,
    "applyMode" "PromotionApplyMode" NOT NULL,
    "code" TEXT,
    "value" INTEGER NOT NULL DEFAULT 0,
    "buyQty" INTEGER NOT NULL DEFAULT 0,
    "getQty" INTEGER NOT NULL DEFAULT 0,
    "minOrderPrice" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "showBanner" BOOLEAN NOT NULL DEFAULT false,
    "bannerText" JSONB,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionGiftProduct" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionGiftProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardType" "PromotionRewardType" NOT NULL,
    "code" TEXT,
    "amountPrice" INTEGER NOT NULL,
    "giftVariantId" TEXT,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Promotion_applyMode_isActive_startsAt_expiresAt_idx" ON "Promotion"("applyMode", "isActive", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "Promotion_isActive_showBanner_idx" ON "Promotion"("isActive", "showBanner");

-- CreateIndex
CREATE INDEX "PromotionGiftProduct_variantId_idx" ON "PromotionGiftProduct"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionGiftProduct_promotionId_variantId_key" ON "PromotionGiftProduct"("promotionId", "variantId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_promotionId_userId_idx" ON "PromotionRedemption"("promotionId", "userId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_orderId_idx" ON "PromotionRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_promotionId_orderId_key" ON "PromotionRedemption"("promotionId", "orderId");

-- AddForeignKey
ALTER TABLE "PromotionGiftProduct" ADD CONSTRAINT "PromotionGiftProduct_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionGiftProduct" ADD CONSTRAINT "PromotionGiftProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_giftVariantId_fkey" FOREIGN KEY ("giftVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
