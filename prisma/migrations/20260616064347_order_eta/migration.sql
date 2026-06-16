-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "estimatedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "estimatedDeliveryDays" INTEGER;
