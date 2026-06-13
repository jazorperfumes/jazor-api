import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error.js";
import { ok } from "../utils/respond.js";
import * as dashSvc from "../services/adminDashboardService.js";
import * as prodSvc from "../services/adminProductsService.js";
import * as prodImportSvc from "../services/adminProductImportService.js";
import * as invSvc from "../services/adminInventoryService.js";
import * as imgSvc from "../services/adminImagesService.js";
import * as ordSvc from "../services/adminOrdersService.js";
import * as promoSvc from "../services/adminPromotionsService.js";
import * as custSvc from "../services/adminCustomersService.js";
import * as revSvc from "../services/adminReviewsService.js";
import * as msgSvc from "../services/adminMessagesService.js";
import * as newsSvc from "../services/adminNewsletterService.js";

// ─── shared schemas ───────────────────────────────────────────────────────

const COLLECTION = z.enum(["FRENCH", "ARABIC"]);
const TIER = z.enum(["SIGNATURE", "DARK"]);
const FAMILY = z.enum(["FLORAL", "WOODY", "ORIENTAL", "FRESH", "OUD", "AMBER", "CITRUS", "AQUATIC", "GOURMAND"]);
const MOOD = z.enum(["CONFIDENT", "CALM", "MYSTERIOUS", "FRESH"]);
const OCCASION = z.enum(["DAY", "EVENING", "SPECIAL", "DAILY"]);
const ORDER_STATUS = z.enum([
  "CREATED",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);
const PAYMENT_STATUS = z.enum(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"]);
const REVIEW_STATUS = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const I18N = z.object({ en: z.string(), ar: z.string() });
const I18N_LIST = z.object({ en: z.array(z.string()), ar: z.array(z.string()) });
const boolParam = z
  .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
  .optional();
const idParam = z.object({ id: z.string().min(1) });

function requireActor(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Auth required");
  return req.user.sub;
}

// ─── dashboard ────────────────────────────────────────────────────────────

export async function dashboard(_req: Request, res: Response) {
  const data = await dashSvc.dashboard();
  ok(res, data);
}

// ─── products ─────────────────────────────────────────────────────────────

const productListQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  collection: COLLECTION.optional(),
  tier: TIER.optional(),
  family: FAMILY.optional(),
  isActive: boolParam,
  includeDeleted: boolParam,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function productsList(req: Request, res: Response) {
  const q = productListQuery.parse(req.query);
  ok(res, await prodSvc.list(q));
}

export async function productsGet(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await prodSvc.detail(id));
}

const productUpsertSchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  name: I18N,
  description: I18N,
  collection: COLLECTION,
  tier: TIER.nullish(),
  family: FAMILY,
  longevity: z.number().int().min(1).max(10),
  sillage: z.number().int().min(1).max(10),
  topNotes: I18N_LIST,
  heartNotes: I18N_LIST,
  baseNotes: I18N_LIST,
  moods: z.array(MOOD),
  occasions: z.array(OCCASION),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

export async function productsCreate(req: Request, res: Response) {
  const body = productUpsertSchema.parse(req.body);
  ok(res, await prodSvc.create(body), 201);
}

const productPatchSchema = productUpsertSchema.partial();

export async function productsPatch(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = productPatchSchema.parse(req.body);
  ok(res, await prodSvc.patch(id, body));
}

export async function productsDelete(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await prodSvc.softDelete(id));
}

export async function productsRestore(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await prodSvc.restore(id));
}

// ─── product import (CSV) ─────────────────────────────────────────────────

function requireCsvFile(req: Request): Buffer {
  const file = req.file;
  if (!file) throw new HttpError(400, "FILE_INVALID", "CSV file is required");
  return file.buffer;
}

export async function productsImportPreview(req: Request, res: Response) {
  ok(res, await prodImportSvc.preview(requireCsvFile(req)));
}

const importRowSchema = z.object({
  cells: z.record(z.string(), z.string()),
});

export async function productsImportValidateRow(req: Request, res: Response) {
  const { cells } = importRowSchema.parse(req.body);
  ok(res, await prodImportSvc.validateOne(cells));
}

export async function productsImportApplyRow(req: Request, res: Response) {
  const { cells } = importRowSchema.parse(req.body);
  ok(res, await prodImportSvc.applyOne(cells));
}

export async function productsImportTemplate(_req: Request, res: Response) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="jazor-products-template.csv"',
  );
  res.status(200).send(prodImportSvc.templateCsv());
}

// ─── variants ─────────────────────────────────────────────────────────────

const variantCreateSchema = z.object({
  sku: z.string().min(1).max(60),
  sizeMl: z.number().int().positive(),
  price: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export async function variantCreate(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = variantCreateSchema.parse(req.body);
  ok(res, await prodSvc.variantCreate(id, body), 201);
}

const variantPatchSchema = z.object({
  sku: z.string().min(1).max(60).optional(),
  sizeMl: z.number().int().positive().optional(),
  price: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export async function variantPatch(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = variantPatchSchema.parse(req.body);
  ok(res, await prodSvc.variantPatch(id, body));
}

export async function variantDelete(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await prodSvc.variantSoftDelete(id));
}

// ─── inventory ────────────────────────────────────────────────────────────

const inventoryListQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  lowStockOnly: boolParam,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function inventoryList(req: Request, res: Response) {
  const q = inventoryListQuery.parse(req.query);
  ok(res, await invSvc.list(q));
}

const inventoryAdjustSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).max(80),
  note: z.string().max(500).optional(),
});

export async function inventoryAdjust(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = inventoryAdjustSchema.parse(req.body);
  const actor = requireActor(req);
  ok(res, await invSvc.adjust(id, actor, body));
}

// ─── images ───────────────────────────────────────────────────────────────

export async function imagesUpload(req: Request, res: Response) {
  const { id: productId } = idParam.parse(req.params);
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    throw new HttpError(400, "FILE_INVALID", "No file uploaded");
  }
  const variantId =
    typeof req.body?.variantId === "string" ? req.body.variantId.trim() : "";
  if (!variantId) {
    throw new HttpError(400, "VALIDATION_ERROR", "variantId is required");
  }
  const altEn = typeof req.body?.altEn === "string" ? req.body.altEn : undefined;
  const altAr = typeof req.body?.altAr === "string" ? req.body.altAr : undefined;
  const dto = await imgSvc.uploadOne({
    productId,
    variantId,
    buffer: file.buffer,
    altEn,
    altAr,
  });
  ok(res, dto, 201);
}

const imageUpdateSchema = z.object({
  position: z.number().int().min(0).optional(),
  alt: z.union([I18N, z.null()]).optional(),
  variantId: z.string().min(1).optional(),
});

export async function imageUpdate(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = imageUpdateSchema.parse(req.body);
  ok(res, await imgSvc.updateImage(id, body));
}

export async function imageDelete(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await imgSvc.removeImage(id));
}

// ─── orders ───────────────────────────────────────────────────────────────

const orderListQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: ORDER_STATUS.optional(),
  paymentStatus: PAYMENT_STATUS.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function ordersList(req: Request, res: Response) {
  const q = orderListQuery.parse(req.query);
  ok(res, await ordSvc.list(q));
}

export async function ordersGet(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await ordSvc.detail(id));
}

const ordersStatusSchema = z.object({
  status: ORDER_STATUS,
  note: z.string().max(500).optional(),
});

export async function ordersSetStatus(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = ordersStatusSchema.parse(req.body);
  const actor = requireActor(req);
  ok(res, await ordSvc.setStatus(id, actor, body));
}

const ordersShipSchema = z.object({
  courierName: z.string().min(1).max(80),
  awb: z.string().min(1).max(80),
  trackingUrl: z.string().url().optional(),
  weightGrams: z.number().int().positive().optional(),
  lengthCm: z.number().int().positive().optional(),
  breadthCm: z.number().int().positive().optional(),
  heightCm: z.number().int().positive().optional(),
  pickupAddressId: z.string().optional(),
});

export async function ordersShip(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = ordersShipSchema.parse(req.body);
  const actor = requireActor(req);
  ok(res, await ordSvc.manualShip(id, actor, body));
}

const ordersRateShopSchema = z.object({
  pickupAddressId: z.string().min(1),
  weightGrams: z.number().int().positive(),
  lengthCm: z.number().int().positive(),
  breadthCm: z.number().int().positive(),
  heightCm: z.number().int().positive(),
});

export async function ordersRateShop(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = ordersRateShopSchema.parse(req.body);
  ok(res, await ordSvc.rateShop(id, body));
}

const ordersShipLiveSchema = ordersRateShopSchema.extend({
  courierId: z.number().int().positive(),
});

export async function ordersShipLive(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = ordersShipLiveSchema.parse(req.body);
  const actor = requireActor(req);
  ok(res, await ordSvc.liveShip(id, actor, body));
}

const shipmentCancelSchema = z.object({
  reason: z.string().min(1).max(200),
});

export async function shipmentCancel(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = shipmentCancelSchema.parse(req.body);
  ok(res, await ordSvc.cancelShipment(id, body.reason));
}

// ─── promotions ───────────────────────────────────────────────────────────

const i18nSchema = z.object({ en: z.string(), ar: z.string() });

const promotionUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  rewardType: z.enum(["PERCENT", "FLAT", "FREE_SHIPPING", "BUY_X_GET_Y"]),
  applyMode: z.enum(["AUTOMATIC", "CODE"]),
  // Empty string allowed (AUTOMATIC promos send ""); the CODE-needs-a-code rule
  // is enforced in the service (validateRewardShape), not here.
  code: z.string().max(40).nullable().optional(),
  value: z.number().int().nonnegative().optional(),
  buyQty: z.number().int().nonnegative().optional(),
  getQty: z.number().int().nonnegative().optional(),
  minOrderPrice: z.number().int().nonnegative().optional(),
  maxUses: z.number().int().nonnegative().optional(),
  perUserLimit: z.number().int().nonnegative().optional(),
  stackable: z.boolean().optional(),
  priority: z.number().int().optional(),
  showBanner: z.boolean().optional(),
  bannerText: i18nSchema.nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
  giftVariantIds: z.array(z.string().min(1)).max(50).optional(),
});

const promotionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(["active", "scheduled", "expired", "inactive", "all"])
    .default("active"),
});

export async function promotionsList(req: Request, res: Response) {
  const query = promotionListQuerySchema.parse(req.query);
  ok(res, await promoSvc.list(query));
}

export async function promotionsGiftOptions(_req: Request, res: Response) {
  ok(res, await promoSvc.giftVariantOptions());
}

export async function promotionsCreate(req: Request, res: Response) {
  const body = promotionUpsertSchema.parse(req.body);
  ok(res, await promoSvc.create(body), 201);
}

const promotionPatchSchema = promotionUpsertSchema.partial();

export async function promotionsPatch(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = promotionPatchSchema.parse(req.body);
  ok(res, await promoSvc.patch(id, body));
}

export async function promotionsDeactivate(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await promoSvc.deactivate(id));
}

// ─── customers ────────────────────────────────────────────────────────────

const customersListQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function customersList(req: Request, res: Response) {
  const q = customersListQuery.parse(req.query);
  ok(res, await custSvc.list(q));
}

export async function customersGet(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await custSvc.detail(id));
}

// ─── reviews ──────────────────────────────────────────────────────────────

const reviewsListQuery = z.object({
  status: REVIEW_STATUS.optional(),
  productId: z.string().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function reviewsList(req: Request, res: Response) {
  const q = reviewsListQuery.parse(req.query);
  ok(res, await revSvc.list(q));
}

export async function reviewsDelete(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await revSvc.remove(id));
}

const reviewReplySchema = z.object({ adminReply: z.string().min(1).max(2000) });

export async function reviewsReply(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = reviewReplySchema.parse(req.body);
  ok(res, await revSvc.reply(id, body));
}

// ─── messages ─────────────────────────────────────────────────────────────

const messagesListQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function messagesList(req: Request, res: Response) {
  const q = messagesListQuery.parse(req.query);
  ok(res, await msgSvc.list(q));
}

const messagesStatusSchema = z.object({
  status: z.enum(["new", "in_progress", "replied", "closed"]),
});

export async function messagesSetStatus(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = messagesStatusSchema.parse(req.body);
  ok(res, await msgSvc.setStatus(id, body));
}

// ─── newsletter ───────────────────────────────────────────────────────────

const newsletterListQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  activeOnly: boolParam,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function newsletterList(req: Request, res: Response) {
  const q = newsletterListQuery.parse(req.query);
  ok(res, await newsSvc.list(q));
}

export async function newsletterExport(req: Request, res: Response) {
  const q = newsletterListQuery.parse(req.query);
  const csv = await newsSvc.exportCsv(q);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="newsletter.csv"');
  res.status(200).send(csv);
}
