-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('SIGNATURE', 'DARK');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tier" "Tier";

-- CreateIndex
CREATE INDEX "Product_tier_idx" ON "Product"("tier");
