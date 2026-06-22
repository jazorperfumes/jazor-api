import { Prisma } from "@prisma/client";
import { customAlphabet } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { pickPrimaryImage } from "./productImage.js";
import type {
  AdminProductDetailDto,
  AdminProductListItemDto,
  AdminProductListQuery,
  AdminProductListResponse,
  AdminProductPatchRequest,
  AdminProductUpsertRequest,
  AdminProductVariantDto,
  AdminVariantCreateRequest,
  AdminVariantPatchRequest,
} from "../types/admin.js";
import type {
  I18nList,
  I18nString,
  Mood,
  Occasion,
  ProductImageSummaryDto,
} from "../types/products.js";

// ─── helpers ───────────────────────────────────────────────────────────────

const slugTail = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 5);

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

function jsonToI18nNullable(v: Prisma.JsonValue | null | undefined): I18nString | null {
  if (!v) return null;
  return jsonToI18n(v);
}

function jsonToI18nList(v: Prisma.JsonValue | null | undefined): I18nList {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const pick = (k: string): string[] =>
      Array.isArray(o[k])
        ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
    return { en: pick("en"), ar: pick("ar") };
  }
  return { en: [], ar: [] };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function ensureUniqueSlug(desired: string, excludeId?: string): Promise<string> {
  let candidate = desired || `product-${slugTail()}`;
  for (let i = 0; i < 5; i++) {
    const existing = await prisma.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${desired}-${slugTail()}`;
  }
  throw new HttpError(409, "SLUG_TAKEN", "Slug already in use");
}

// ─── DTO mappers ───────────────────────────────────────────────────────────

type PrismaListProduct = Prisma.ProductGetPayload<{
  include: { variants: { include: { images: true } } };
}>;

const productInclude = {
  variants: { include: { images: true } },
} satisfies Prisma.ProductInclude;

function toListItemDto(p: PrismaListProduct): AdminProductListItemDto {
  const variants = p.variants.filter((v) => !v.deletedAt);
  const prices = variants.filter((v) => v.isActive).map((v) => v.price);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const totalStock = variants.reduce((s, v) => s + v.stock, 0);
  const primary = pickPrimaryImage(p.variants);
  return {
    id: p.id,
    slug: p.slug,
    name: jsonToI18n(p.name),
    collection: p.collection,
    tier: p.tier,
    family: p.family,
    intensity: p.intensity,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    variantCount: variants.length,
    totalStock,
    minPrice,
    primaryImage: primary
      ? {
          id: primary.id,
          variantId: primary.variantId,
          url: primary.url,
          alt: jsonToI18nNullable(primary.alt),
        }
      : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toVariantDto(v: {
  id: string;
  sku: string;
  sizeMl: number;
  price: number;
  stock: number;
  weightGrams: number | null;
  lengthCm: number | null;
  breadthCm: number | null;
  heightCm: number | null;
  isActive: boolean;
  deletedAt: Date | null;
}): AdminProductVariantDto {
  return {
    id: v.id,
    sku: v.sku,
    sizeMl: v.sizeMl,
    price: v.price,
    stock: v.stock,
    weightGrams: v.weightGrams,
    lengthCm: v.lengthCm,
    breadthCm: v.breadthCm,
    heightCm: v.heightCm,
    isActive: v.isActive,
    deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
  };
}

function toDetailDto(p: PrismaListProduct): AdminProductDetailDto {
  const sortedVariants = p.variants
    .slice()
    .sort((a, b) => a.sizeMl - b.sizeMl);
  const variants = sortedVariants.map(toVariantDto);
  // Per-variant images, flattened in variant order then position.
  const images: ProductImageSummaryDto[] = sortedVariants.flatMap((v) =>
    v.images
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((img) => ({
        id: img.id,
        variantId: v.id,
        url: img.url,
        alt: jsonToI18nNullable(img.alt),
      })),
  );
  return {
    id: p.id,
    slug: p.slug,
    name: jsonToI18n(p.name),
    description: jsonToI18n(p.description),
    collection: p.collection,
    tier: p.tier,
    family: p.family,
    intensity: p.intensity,
    longevity: p.longevity,
    sillage: p.sillage,
    moods: p.moods as Mood[],
    occasions: p.occasions as Occasion[],
    notes: {
      top: jsonToI18nList(p.topNotes),
      heart: jsonToI18nList(p.heartNotes),
      base: jsonToI18nList(p.baseNotes),
    },
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    variants,
    images,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── list ──────────────────────────────────────────────────────────────────

export async function list(query: AdminProductListQuery): Promise<AdminProductListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const skip = (page - 1) * pageSize;

  const and: Prisma.ProductWhereInput[] = [];
  if (!query.includeDeleted) and.push({ deletedAt: null });
  if (query.collection) and.push({ collection: query.collection });
  if (query.tier) and.push({ tier: query.tier });
  if (query.family) and.push({ family: query.family });
  if (query.isActive !== undefined) and.push({ isActive: query.isActive });

  let ids: string[] | null = null;
  if (query.q && query.q.trim().length > 0) {
    const q = `%${query.q.trim()}%`;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "Product"
      WHERE (name->>'en' ILIKE ${q} OR name->>'ar' ILIKE ${q} OR slug ILIKE ${q})
    `);
    ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return { items: [], page, pageSize, total: 0 };
    }
    and.push({ id: { in: ids } });
  }

  const where: Prisma.ProductWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: pageSize,
      include: productInclude,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: rows.map(toListItemDto),
    page,
    pageSize,
    total,
  };
}

// ─── detail ────────────────────────────────────────────────────────────────

export async function detail(id: string): Promise<AdminProductDetailDto> {
  const p = await prisma.product.findUnique({
    where: { id },
    include: productInclude,
  });
  if (!p) throw new HttpError(404, "NOT_FOUND", "Product not found");
  return toDetailDto(p);
}

// ─── create ────────────────────────────────────────────────────────────────

export async function create(input: AdminProductUpsertRequest): Promise<AdminProductDetailDto> {
  const desiredSlug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name.en);
  const slug = await ensureUniqueSlug(desiredSlug);

  const product = await prisma.product.create({
    data: {
      slug,
      name: input.name as unknown as Prisma.InputJsonValue,
      description: input.description as unknown as Prisma.InputJsonValue,
      collection: input.collection,
      tier: input.tier ?? null,
      family: input.family,
      intensity: input.intensity,
      longevity: input.longevity,
      sillage: input.sillage,
      topNotes: input.topNotes as unknown as Prisma.InputJsonValue,
      heartNotes: input.heartNotes as unknown as Prisma.InputJsonValue,
      baseNotes: input.baseNotes as unknown as Prisma.InputJsonValue,
      moods: input.moods,
      occasions: input.occasions,
      isActive: input.isActive ?? true,
      isFeatured: input.isFeatured ?? false,
    },
    include: productInclude,
  });
  return toDetailDto(product);
}

// ─── patch ─────────────────────────────────────────────────────────────────

export async function patch(id: string, input: AdminProductPatchRequest): Promise<AdminProductDetailDto> {
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");

  const data: Prisma.ProductUpdateInput = {};
  if (input.slug !== undefined) {
    const desired = slugify(input.slug);
    if (desired !== existing.slug) {
      data.slug = await ensureUniqueSlug(desired, id);
    }
  }
  if (input.name) data.name = input.name as unknown as Prisma.InputJsonValue;
  if (input.description) data.description = input.description as unknown as Prisma.InputJsonValue;
  if (input.collection) data.collection = input.collection;
  if (input.tier !== undefined) data.tier = input.tier;
  if (input.family) data.family = input.family;
  if (input.intensity !== undefined) data.intensity = input.intensity;
  if (input.longevity !== undefined) data.longevity = input.longevity;
  if (input.sillage !== undefined) data.sillage = input.sillage;
  if (input.topNotes) data.topNotes = input.topNotes as unknown as Prisma.InputJsonValue;
  if (input.heartNotes) data.heartNotes = input.heartNotes as unknown as Prisma.InputJsonValue;
  if (input.baseNotes) data.baseNotes = input.baseNotes as unknown as Prisma.InputJsonValue;
  if (input.moods) data.moods = input.moods;
  if (input.occasions) data.occasions = input.occasions;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;

  const product = await prisma.product.update({
    where: { id },
    data,
    include: productInclude,
  });
  return toDetailDto(product);
}

// ─── soft delete + restore ────────────────────────────────────────────────

export async function softDelete(id: string): Promise<{ id: string }> {
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");
  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  return { id };
}

export async function restore(id: string): Promise<AdminProductDetailDto> {
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");
  const product = await prisma.product.update({
    where: { id },
    data: { deletedAt: null },
    include: productInclude,
  });
  return toDetailDto(product);
}

// ─── variants ──────────────────────────────────────────────────────────────

export async function variantCreate(
  productId: string,
  input: AdminVariantCreateRequest,
): Promise<AdminProductVariantDto> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

  const existing = await prisma.productVariant.findUnique({
    where: { sku: input.sku },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, "SKU_TAKEN", "SKU already in use");

  const v = await prisma.productVariant.create({
    data: {
      productId,
      sku: input.sku,
      sizeMl: input.sizeMl,
      price: input.price,
      stock: input.stock ?? 0,
      weightGrams: input.weightGrams ?? null,
      lengthCm: input.lengthCm ?? null,
      breadthCm: input.breadthCm ?? null,
      heightCm: input.heightCm ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return toVariantDto(v);
}

export async function variantPatch(
  variantId: string,
  input: AdminVariantPatchRequest,
): Promise<AdminProductVariantDto> {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, sku: true },
  });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Variant not found");

  if (input.sku && input.sku !== existing.sku) {
    const dup = await prisma.productVariant.findUnique({
      where: { sku: input.sku },
      select: { id: true },
    });
    if (dup) throw new HttpError(409, "SKU_TAKEN", "SKU already in use");
  }

  const data: Prisma.ProductVariantUpdateInput = {};
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.sizeMl !== undefined) data.sizeMl = input.sizeMl;
  if (input.price !== undefined) data.price = input.price;
  if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams;
  if (input.lengthCm !== undefined) data.lengthCm = input.lengthCm;
  if (input.breadthCm !== undefined) data.breadthCm = input.breadthCm;
  if (input.heightCm !== undefined) data.heightCm = input.heightCm;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const v = await prisma.productVariant.update({ where: { id: variantId }, data });
  return toVariantDto(v);
}

export async function variantSoftDelete(variantId: string): Promise<{ id: string }> {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true },
  });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Variant not found");
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { deletedAt: new Date(), isActive: false },
  });
  return { id: variantId };
}
