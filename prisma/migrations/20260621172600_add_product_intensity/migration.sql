-- CreateEnum
CREATE TYPE "Intensity" AS ENUM ('LIGHT', 'MODERATE', 'STRONG', 'IMPACTFUL');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "intensity" "Intensity";
