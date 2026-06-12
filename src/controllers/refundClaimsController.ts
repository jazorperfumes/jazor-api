import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "../services/refundClaimsService.js";
import * as adminSvc from "../services/adminRefundClaimsService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type {
  RefundClaimDto,
  RefundClaimListResponse,
} from "../types/refundClaims.js";

const submitSchema = z.object({
  orderId: z.string().min(1),
  orderItemId: z.string().min(1),
  reasonCode: z.enum(["DAMAGED_BOTTLE"]),
  userDescription: z.string().min(10).max(2000),
});

const idParam = z.object({ id: z.string().min(1) });
const orderIdParam = z.object({ id: z.string().min(1) });

function userId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

// ─── user endpoints ──────────────────────────────────────────────────────

export async function submit(req: Request, res: Response) {
  const body = submitSchema.parse({
    orderId: req.body?.orderId,
    orderItemId: req.body?.orderItemId,
    reasonCode: req.body?.reasonCode,
    userDescription: req.body?.userDescription,
  });
  const files = ((req as unknown as { files?: Express.Multer.File[] }).files ?? []) as Express.Multer.File[];
  const claim = await svc.submit(userId(req), { ...body, files });
  ok<RefundClaimDto>(res, claim, 201);
}

export async function getOwn(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const claim = await svc.getOwn(userId(req), id);
  ok<RefundClaimDto>(res, claim);
}

export async function listForOrder(req: Request, res: Response) {
  const { id } = orderIdParam.parse(req.params);
  const items = await svc.listForOrder(userId(req), id);
  ok<{ items: RefundClaimDto[] }>(res, { items });
}

export async function eligibleItems(req: Request, res: Response) {
  const { id } = orderIdParam.parse(req.params);
  const itemIds = await svc.eligibleItemIds(userId(req), id);
  ok<{ itemIds: string[] }>(res, { itemIds });
}

// ─── admin endpoints ─────────────────────────────────────────────────────

const adminListQuery = z.object({
  status: z.enum(["REQUESTED", "REJECTED", "APPROVED", "PENDING", "PROCESSED", "FAILED"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const adminApproveSchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

const adminRejectSchema = z.object({
  reviewNote: z.string().min(5).max(2000),
});

function actorId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function adminList(req: Request, res: Response) {
  const q = adminListQuery.parse(req.query);
  ok<RefundClaimListResponse>(res, await adminSvc.list(q));
}

export async function adminDetail(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok<RefundClaimDto>(res, await adminSvc.detail(id));
}

export async function adminApprove(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = adminApproveSchema.parse(req.body ?? {});
  ok<RefundClaimDto>(res, await adminSvc.approve(id, actorId(req), body));
}

export async function adminReject(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = adminRejectSchema.parse(req.body ?? {});
  ok<RefundClaimDto>(res, await adminSvc.reject(id, actorId(req), body));
}
