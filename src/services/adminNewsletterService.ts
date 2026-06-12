import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type {
  AdminNewsletterDto,
  AdminNewsletterListQuery,
  AdminNewsletterListResponse,
} from "../types/admin.js";

function toDto(n: {
  id: string;
  email: string;
  subscribedAt: Date;
  unsubscribedAt: Date | null;
}): AdminNewsletterDto {
  return {
    id: n.id,
    email: n.email,
    subscribedAt: n.subscribedAt.toISOString(),
    unsubscribedAt: n.unsubscribedAt ? n.unsubscribedAt.toISOString() : null,
  };
}

function buildWhere(query: AdminNewsletterListQuery): Prisma.NewsletterSubscriptionWhereInput {
  const and: Prisma.NewsletterSubscriptionWhereInput[] = [];
  if (query.activeOnly) and.push({ unsubscribedAt: null });
  if (query.q && query.q.trim().length > 0) {
    and.push({ email: { contains: query.q.trim(), mode: "insensitive" } });
  }
  return { AND: and };
}

export async function list(query: AdminNewsletterListQuery): Promise<AdminNewsletterListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const skip = (page - 1) * pageSize;
  const where = buildWhere(query);

  const [rows, total] = await Promise.all([
    prisma.newsletterSubscription.findMany({
      where,
      orderBy: { subscribedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.newsletterSubscription.count({ where }),
  ]);
  return { items: rows.map(toDto), page, pageSize, total };
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportCsv(query: AdminNewsletterListQuery): Promise<string> {
  const where = buildWhere(query);
  const rows = await prisma.newsletterSubscription.findMany({
    where,
    orderBy: { subscribedAt: "desc" },
  });
  const header = "email,subscribed_at,unsubscribed_at\n";
  const body = rows
    .map(
      (r) =>
        `${escapeCsv(r.email)},${r.subscribedAt.toISOString()},${
          r.unsubscribedAt ? r.unsubscribedAt.toISOString() : ""
        }`,
    )
    .join("\n");
  return header + body + (body ? "\n" : "");
}
