import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type {
  I18nList,
  I18nString,
  Mood,
  Occasion,
  ProductDetailDto,
  ProductListItemDto,
  ProductListQuery,
  ProductListResponse,
  RelatedProductsResponse,
  ReviewDto,
  ReviewListResponse,
  ReviewListSort,
} from "../types/products.js";

/**
 * Listing strategy:
 * - newest/featured → prisma findMany with includes (single round trip + count).
 * - priceAsc/priceDesc → raw SQL produces the ordered+paginated id list
 *   (since min(variant.price) is not directly orderable via Prisma), then
 *   prisma hydrates includes and we re-sort to preserve raw order.
 *
 * Public list excludes inactive/soft-deleted products + variants.
 */

export type PrismaListProduct = Prisma.ProductGetPayload<{
  include: {
    variants: true;
    images: true;
  };
}>;

interface FilterShape {
  collection?: ProductListQuery["collection"];
  tier?: ProductListQuery["tier"];
  family?: ProductListQuery["family"];
  q?: string;
  minPrice?: number;
  maxPrice?: number;
}

function buildWhere(f: FilterShape): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [
    { isActive: true, deletedAt: null },
  ];

  if (f.collection) and.push({ collection: f.collection });
  if (f.tier) and.push({ tier: f.tier });
  if (f.family) and.push({ family: f.family });

  // q-bearing queries route through listRaw (case-insensitive ILIKE) — Prisma
  // JSON `string_contains` is case-sensitive in Postgres and has no insensitive
  // mode, so this path only handles q-less filters.

  // Variant price filter — product matches if ANY active variant falls in range.
  // Also require >=1 active variant exists so variantless products don't render
  // as "From —" on cards.
  const variantFilters: Prisma.ProductVariantWhereInput = {
    isActive: true,
    deletedAt: null,
  };
  if (f.minPrice != null) variantFilters.price = { ...(variantFilters.price as object | undefined), gte: f.minPrice };
  if (f.maxPrice != null) variantFilters.price = { ...(variantFilters.price as object | undefined), lte: f.maxPrice };
  and.push({ variants: { some: variantFilters } });

  return { AND: and };
}

function jsonToI18n(value: Prisma.JsonValue | null | undefined): I18nString {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return {
      en: typeof v.en === "string" ? v.en : "",
      ar: typeof v.ar === "string" ? v.ar : "",
    };
  }
  return { en: "", ar: "" };
}

function jsonToI18nNullable(value: Prisma.JsonValue | null | undefined): I18nString | null {
  if (!value) return null;
  return jsonToI18n(value);
}

export function toListItemDto(p: PrismaListProduct): ProductListItemDto {
  const activeVariants = p.variants.filter((v) => v.isActive && !v.deletedAt);
  const variants = activeVariants
    .slice()
    .sort((a, b) => a.sizeMl - b.sizeMl)
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      sizeMl: v.sizeMl,
      price: v.price,
      inStock: v.stock > 0,
    }));

  const primary = p.images.slice().sort((a, b) => a.position - b.position)[0];
  const primaryImage = primary
    ? { id: primary.id, url: primary.url, alt: jsonToI18nNullable(primary.alt) }
    : null;

  const prices = activeVariants.map((v) => v.price);
  const minPrice = prices.length ? Math.min(...prices) : null;

  return {
    id: p.id,
    slug: p.slug,
    name: jsonToI18n(p.name),
    collection: p.collection,
    tier: p.tier,
    family: p.family,
    longevity: p.longevity,
    sillage: p.sillage,
    isFeatured: p.isFeatured,
    primaryImage,
    variants,
    minPrice,
  };
}

async function listOrderedDefault(
  where: Prisma.ProductWhereInput,
  orderBy: Prisma.ProductOrderByWithRelationInput[],
  skip: number,
  take: number,
): Promise<{ rows: PrismaListProduct[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { variants: true, images: true },
    }),
    prisma.product.count({ where }),
  ]);
  return { rows, total };
}

type RawSort = "featured" | "newest" | "priceAsc" | "priceDesc";

async function listRaw(
  f: FilterShape,
  sort: RawSort,
  skip: number,
  take: number,
): Promise<{ rows: PrismaListProduct[]; total: number }> {
  // Build SQL fragments mirroring buildWhere semantics.
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p."isActive" = TRUE AND p."deletedAt" IS NULL`,
  ];
  if (f.collection) conditions.push(Prisma.sql`p."collection" = ${f.collection}::"Collection"`);
  if (f.tier) conditions.push(Prisma.sql`p."tier" = ${f.tier}::"Tier"`);
  if (f.family) conditions.push(Prisma.sql`p."family" = ${f.family}::"Family"`);
  if (f.q && f.q.trim().length > 0) {
    const q = `%${f.q.trim()}%`;
    conditions.push(
      Prisma.sql`(p."name"->>'en' ILIKE ${q} OR p."name"->>'ar' ILIKE ${q})`,
    );
  }
  // Aggregate against active variants only. Use HAVING for price range so the
  // min(price) still represents the active+in-range variant set per product.
  const havingParts: Prisma.Sql[] = [];
  if (f.minPrice != null) havingParts.push(Prisma.sql`MIN(v."price") >= ${f.minPrice}`);
  if (f.maxPrice != null) havingParts.push(Prisma.sql`MIN(v."price") <= ${f.maxPrice}`);

  const whereSql = Prisma.join(conditions, " AND ");
  const havingSql =
    havingParts.length > 0
      ? Prisma.sql`HAVING ${Prisma.join(havingParts, " AND ")}`
      : Prisma.empty;
  const orderSql =
    sort === "priceAsc"
      ? Prisma.sql`ORDER BY min_price ASC NULLS LAST, p."createdAt" DESC`
      : sort === "priceDesc"
      ? Prisma.sql`ORDER BY min_price DESC NULLS LAST, p."createdAt" DESC`
      : sort === "newest"
      ? Prisma.sql`ORDER BY p."createdAt" DESC`
      : Prisma.sql`ORDER BY p."isFeatured" DESC, p."createdAt" DESC`;

  const idRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id, MIN(v."price") AS min_price
    FROM "Product" p
    INNER JOIN "ProductVariant" v
      ON v."productId" = p.id
     AND v."isActive" = TRUE
     AND v."deletedAt" IS NULL
    WHERE ${whereSql}
    GROUP BY p.id
    ${havingSql}
    ${orderSql}
    LIMIT ${take} OFFSET ${skip}
  `);

  // Total uses the same predicate (without ORDER/LIMIT) — count distinct products.
  const totalRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT p.id
      FROM "Product" p
      INNER JOIN "ProductVariant" v
        ON v."productId" = p.id
       AND v."isActive" = TRUE
       AND v."deletedAt" IS NULL
      WHERE ${whereSql}
      GROUP BY p.id
      ${havingSql}
    ) sub
  `);
  const total = totalRows[0] ? Number(totalRows[0].count) : 0;

  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return { rows: [], total };

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { variants: true, images: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((x): x is PrismaListProduct => Boolean(x));

  return { rows: ordered, total };
}

export async function list(query: ProductListQuery): Promise<ProductListResponse> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 24;
  const skip = (page - 1) * pageSize;
  const sort = query.sort ?? "featured";

  const f: FilterShape = {
    collection: query.collection,
    tier: query.tier,
    family: query.family,
    q: query.q,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
  };

  let rows: PrismaListProduct[];
  let total: number;

  const hasQuery = Boolean(f.q && f.q.trim().length > 0);
  if (sort === "priceAsc" || sort === "priceDesc" || hasQuery) {
    const r = await listRaw(f, sort, skip, pageSize);
    rows = r.rows;
    total = r.total;
  } else {
    const where = buildWhere(f);
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      sort === "newest"
        ? [{ createdAt: "desc" }]
        : [{ isFeatured: "desc" }, { createdAt: "desc" }];
    const r = await listOrderedDefault(where, orderBy, skip, pageSize);
    rows = r.rows;
    total = r.total;
  }

  return {
    items: rows.map(toListItemDto),
    page,
    pageSize,
    total,
  };
}

// ─── detail ────────────────────────────────────────────────────────────────

function jsonToI18nList(value: Prisma.JsonValue | null | undefined): I18nList {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const pick = (k: string): string[] =>
      Array.isArray(v[k])
        ? (v[k] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
    return { en: pick("en"), ar: pick("ar") };
  }
  return { en: [], ar: [] };
}

export async function detail(slug: string): Promise<ProductDetailDto> {
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    include: {
      variants: { where: { isActive: true, deletedAt: null } },
      images: true,
    },
  });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

  const variants = product.variants
    .slice()
    .sort((a, b) => a.sizeMl - b.sizeMl)
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      sizeMl: v.sizeMl,
      price: v.price,
      stock: v.stock,
      inStock: v.stock > 0,
    }));

  const images = product.images
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((img) => ({
      id: img.id,
      url: img.url,
      alt: jsonToI18nNullable(img.alt),
    }));

  // Aggregate review stats. Auto-approved reviews land with APPROVED status per
  // decision 11; PENDING/REJECTED are excluded.
  const agg = await prisma.review.aggregate({
    where: { productId: product.id, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const prices = variants.map((v) => v.price);
  const minPrice = prices.length ? Math.min(...prices) : null;

  return {
    id: product.id,
    slug: product.slug,
    name: jsonToI18n(product.name),
    description: jsonToI18n(product.description),
    collection: product.collection,
    tier: product.tier,
    family: product.family,
    longevity: product.longevity,
    sillage: product.sillage,
    isFeatured: product.isFeatured,
    moods: product.moods as Mood[],
    occasions: product.occasions as Occasion[],
    notes: {
      top: jsonToI18nList(product.topNotes),
      heart: jsonToI18nList(product.heartNotes),
      base: jsonToI18nList(product.baseNotes),
    },
    images,
    variants,
    minPrice,
    reviewSummary: {
      avgRating: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : 0,
      reviewCount: agg._count._all,
    },
    createdAt: product.createdAt.toISOString(),
  };
}

// ─── reviews list ──────────────────────────────────────────────────────────

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

export async function reviews(
  slug: string,
  query: { page: number; pageSize: number; sort: ReviewListSort },
): Promise<ReviewListResponse> {
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

  const where: Prisma.ReviewWhereInput = {
    productId: product.id,
    status: "APPROVED",
  };

  const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
    query.sort === "highRated"
      ? [{ rating: "desc" }, { createdAt: "desc" }]
      : query.sort === "lowRated"
        ? [{ rating: "asc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }];

  const [rows, total, agg] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { user: { select: { name: true } } },
    }),
    prisma.review.count({ where }),
    prisma.review.aggregate({ where, _avg: { rating: true } }),
  ]);

  return {
    items: rows.map(toReviewDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    avgRating: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : 0,
  };
}

// ─── related ───────────────────────────────────────────────────────────────

const RELATED_LIMIT = 4;

export async function related(slug: string): Promise<RelatedProductsResponse> {
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: { id: true, family: true, collection: true },
  });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

  // Pass 1: same family AND same collection.
  const sameFamilyCollection = await prisma.product.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      id: { not: product.id },
      family: product.family,
      collection: product.collection,
    },
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    take: RELATED_LIMIT,
    include: { variants: true, images: true },
  });

  let pool = sameFamilyCollection;
  // Pass 2: same family only, top up.
  if (pool.length < RELATED_LIMIT) {
    const fillers = await prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        id: { notIn: [product.id, ...pool.map((p) => p.id)] },
        family: product.family,
      },
      orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
      take: RELATED_LIMIT - pool.length,
      include: { variants: true, images: true },
    });
    pool = [...pool, ...fillers];
  }

  return { items: pool.map(toListItemDto) };
}
