-- AlterEnum
ALTER TYPE "Family" ADD VALUE 'GOURMAND';

-- AlterTable
ALTER TABLE "Shipment" ALTER COLUMN "provider" SET DEFAULT 'nimbuspost';
