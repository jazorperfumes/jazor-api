import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type {
  AdminReviewDto,
  AdminReviewListQuery,
  AdminReviewListResponse,
  AdminReviewReplyRequest,
} from "../types/admin.js";
import type { I18nString } from "../types/products.js";

function jsonToI18n(v: Prisma.JsonValue | null | undefined): I18nString {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return {
      en: typeof o.en === "string" ? o.en : "",
      ar: typeof o.ar === "string" ? o.ar : "",
    };
  }
  return { en: "", ar: "" };
}

type RowWithRelations = Prisma.ReviewGetPayload<{
  include: {
    user: { select: { email: true; name: true } };
    product: { select: { slug: true; name: true } };
  };
}>;

function toDto(r: RowWithRelations): AdminReviewDto {
  return {
    id: r.id,
    productId: r.productId,
    productName: jsonToI18n(r.product.name),
    productSlug: r.product.slug,
    userId: r.userId,
    userEmail: r.user.email,
    userName: r.user.name,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: r.status,
    adminReply: r.adminReply,
    adminReplyAt: r.adminReplyAt ? r.adminReplyAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function list(query: AdminReviewListQuery): Promise<AdminReviewListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const skip = (page - 1) * pageSize;

  const and: Prisma.ReviewWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.productId) and.push({ productId: query.productId });
  if (query.q && query.q.trim().length > 0) {
    const q = query.q.trim();
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.ReviewWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        user: { select: { email: true, name: true } },
        product: { select: { slug: true, name: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return { items: rows.map(toDto), page, pageSize, total };
}

export async function remove(id: string): Promise<{ id: string }> {
  const existing = await prisma.review.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Review not found");
  await prisma.review.delete({ where: { id } });
  return { id };
}

export async function reply(id: string, input: AdminReviewReplyRequest): Promise<AdminReviewDto> {
  const existing = await prisma.review.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Review not found");
  const r = await prisma.review.update({
    where: { id },
    data: { adminReply: input.adminReply, adminReplyAt: new Date() },
    include: {
      user: { select: { email: true, name: true } },
      product: { select: { slug: true, name: true } },
    },
  });
  return toDto(r);
}
