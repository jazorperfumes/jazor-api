/*
  Warnings:

  - You are about to drop the column `isDefaultBilling` on the `Address` table. All the data in the column will be lost.
  - You are about to drop the column `billingAddress` on the `Order` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Address" DROP COLUMN "isDefaultBilling",
ALTER COLUMN "country" SET DEFAULT 'India';

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "billingAddress";

-- AlterTable
ALTER TABLE "PickupAddress" ALTER COLUMN "country" SET DEFAULT 'India';
