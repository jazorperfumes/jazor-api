import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "../services/accountOrdersService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type { OrderDetailDto } from "../types/orders.js";
import type {
  CancelOrderResponse,
  OrderListResponse,
} from "../types/accountOrders.js";

const listQuery = z.object({
  status: z
    .enum(["CREATED", "PAID", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const idParam = z.object({ id: z.string().min(1) });

function userId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function list(req: Request, res: Response) {
  const q = listQuery.parse(req.query);
  const data = await svc.list(userId(req), q);
  ok<OrderListResponse>(res, data);
}

export async function get(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const data = await svc.get(id, userId(req));
  ok<OrderDetailDto>(res, data);
}

export async function invoice(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { buffer, orderNumber } = await svc.invoiceBuffer(id, userId(req));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="jazor-${orderNumber}.pdf"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.status(200).send(buffer);
}

export async function cancel(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const data = await svc.cancel(id, userId(req));
  ok<CancelOrderResponse>(res, data);
}
