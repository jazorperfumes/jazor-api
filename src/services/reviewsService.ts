import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type { ReviewDto } from "../types/products.js";
import type { CreateReviewRequest } from "../types/reviews.js";

function toReviewDto(
  r: Prisma.ReviewGetPayload<{ include: { user: { select: { name: true } } } }>,
): ReviewDto {
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    authorName: r.user?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    adminReply: r.adminReply,
    adminReplyAt: r.adminReplyAt ? r.adminReplyAt.toISOString() : null,
  };
}

export async function create(userId: string, input: CreateReviewRequest): Promise<ReviewDto> {
  const orderItem = await prisma.orderItem.findUnique({
    where: { id: input.orderItemId },
    select: {
      id: true,
      variantId: true,
      order: { select: { userId: true, status: true } },
      variant: { select: { productId: true } },
      review: { select: { id: true } },
    },
  });
  if (!orderItem || orderItem.order.userId !== userId) {
    throw new HttpError(404, "NOT_FOUND", "Order item not found");
  }
  if (orderItem.order.status !== "DELIVERED") {
    throw new HttpError(400, "REVIEW_NOT_ELIGIBLE", "Reviews allowed only after delivery");
  }
  if (orderItem.review) {
    throw new HttpError(409, "REVIEW_EXISTS", "Review already submitted for this item");
  }
  if (!orderItem.variant) {
    throw new HttpError(400, "REVIEW_NOT_ELIGIBLE", "Cannot review a removed variant");
  }

  const created = await prisma.review.create({
    data: {
      productId: orderItem.variant.productId,
      userId,
      orderItemId: orderItem.id,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
      status: "APPROVED",
    },
    include: { user: { select: { name: true } } },
  });
  return toReviewDto(created);
}

export async function remove(userId: string, reviewId: string): Promise<void> {
  const existing = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== userId) {
    throw new HttpError(404, "NOT_FOUND", "Review not found");
  }
  await prisma.review.delete({ where: { id: reviewId } });
}
