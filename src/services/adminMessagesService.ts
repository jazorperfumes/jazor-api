import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type {
  AdminMessageDto,
  AdminMessageListQuery,
  AdminMessageListResponse,
  AdminMessageStatusRequest,
} from "../types/admin.js";

function toDto(m: {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  status: string;
  createdAt: Date;
}): AdminMessageDto {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    subject: m.subject,
    message: m.message,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function list(query: AdminMessageListQuery): Promise<AdminMessageListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const skip = (page - 1) * pageSize;

  const and: Prisma.ContactMessageWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.q && query.q.trim().length > 0) {
    const q = query.q.trim();
    and.push({
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { subject: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.ContactMessageWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.contactMessage.count({ where }),
  ]);

  return { items: rows.map(toDto), page, pageSize, total };
}

export async function setStatus(
  id: string,
  input: AdminMessageStatusRequest,
): Promise<AdminMessageDto> {
  const existing = await prisma.contactMessage.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Message not found");
  const m = await prisma.contactMessage.update({
    where: { id },
    data: { status: input.status },
  });
  return toDto(m);
}
