import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { toListItemDto } from "./productsService.js";
import type { WishlistResponse } from "../types/wishlist.js";

export async function list(userId: string): Promise<WishlistResponse> {
  const rows = await prisma.wishlistItem.findMany({
    where: {
      userId,
      product: { isActive: true, deletedAt: null },
    },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: {
          variants: { include: { images: true } },
        },
      },
    },
  });
  return { items: rows.map((r) => toListItemDto(r.product)) };
}

export async function add(userId: string, productId: string): Promise<WishlistResponse> {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
  return list(userId);
}

export async function remove(userId: string, productId: string): Promise<WishlistResponse> {
  await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  return list(userId);
}
