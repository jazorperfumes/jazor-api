import { parse } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { uploadBuffer, type UploadResult } from "../lib/cloudinary.js";
import { safeFetch } from "../utils/safeFetch.js";
import type {
  AdminProductImportApplyRowResponse,
  AdminProductImportCells,
  AdminProductImportPreviewRow,
  AdminProductImportReport,
  AdminProductImportRowError,
  AdminProductImportValidateRowResponse,
} from "../types/admin.js";
import type { Collection, Family, Mood, Occasion, Tier } from "../types/products.js";

// ─── config ──────────────────────────────────────────────────────────────

const MAX_ROWS = 500;
const REQUIRED_HEADERS = ["slug", "name_en", "collection", "family"];

const COLLECTIONS = new Set<Collection>(["FRENCH", "ARABIC"]);
const TIERS = new Set<Tier>(["SIGNATURE", "DARK"]);
const INTENSITIES = new Set(["LIGHT", "MODERATE", "STRONG", "IMPACTFUL"]);
const FAMILIES = new Set<Family>([
  "FLORAL",
  "WOODY",
  "ORIENTAL",
  "FRESH",
  "OUD",
  "AMBER",
  "CITRUS",
  "AQUATIC",
  "GOURMAND",
]);
const MOODS = new Set<Mood>(["CONFIDENT", "CALM", "MYSTERIOUS", "FRESH"]);
const OCCASIONS = new Set<Occasion>(["DAY", "EVENING", "SPECIAL", "DAILY"]);

// CSV column layout. Prices are RUPEES (converted ×100 → paise on import).
export const IMPORT_COLUMNS = [
  "slug",
  "name_en",
  "name_ar",
  "description_en",
  "description_ar",
  "collection",
  "tier",
  "family",
  "intensity",
  "longevity",
  "sillage",
  "top_notes_en",
  "top_notes_ar",
  "heart_notes_en",
  "heart_notes_ar",
  "base_notes_en",
  "base_notes_ar",
  "moods",
  "occasions",
  "is_featured",
  "is_active",
  "sku_50",
  "price_50",
  "stock_50",
  "weight_50",
  "sku_100",
  "price_100",
  "stock_100",
  "weight_100",
  // per-variant image URLs; `images` is a shared fallback applied to every
  // variant that has no size-specific column.
  "images",
  "images_50",
  "images_100",
] as const;

// ─── helpers ───────────────────────────────────────────────────────────────

type RawRow = Record<string, string>;

const splitList = (s: string | undefined): string[] =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const truthy = (s: string | undefined): boolean =>
  s === "true" || s === "TRUE" || s === "1";

/** Parse a rupee string ("2,499" / "2499.50") to integer paise, or null if invalid. */
function rupeesToPaise(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function intInRange(s: string | undefined, min: number, max: number): number | null {
  if (!s || !s.trim()) return null;
  const n = Number(s.trim());
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

// ─── parsed row shape ────────────────────────────────────────────────────

interface VariantSpec {
  sku: string;
  sizeMl: number;
  price: number;
  stock: number;
  /** packaged weight in grams; null → DEFAULT_PACKAGE fallback at ship time */
  weightGrams: number | null;
  imageUrls: string[];
}

interface ValidRow {
  row: number;
  slug: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  collection: Collection;
  tier: Tier | null;
  family: Family;
  intensity: any | null;
  longevity: number;
  sillage: number;
  topNotes: { en: string[]; ar: string[] };
  heartNotes: { en: string[]; ar: string[] };
  baseNotes: { en: string[]; ar: string[] };
  moods: Mood[];
  occasions: Occasion[];
  isFeatured: boolean;
  isActive: boolean;
  variants: VariantSpec[];
}

interface ParseResult {
  totalRows: number;
  validRows: ValidRow[];
  errors: AdminProductImportRowError[];
}

// ─── parse CSV → raw rows ────────────────────────────────────────────────────

function parseCsv(buffer: Buffer): RawRow[] {
  let raw: RawRow[];
  try {
    raw = parse(buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unparseable CSV";
    throw new HttpError(400, "VALIDATION_ERROR", `Could not parse CSV: ${msg}`);
  }

  if (raw.length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "CSV has no data rows");
  }
  if (raw.length > MAX_ROWS) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `Too many rows: ${raw.length} (max ${MAX_ROWS})`,
    );
  }

  const headerKeys = Object.keys(raw[0]);
  const missing = REQUIRED_HEADERS.filter((h) => !headerKeys.includes(h));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `Missing required columns: ${missing.join(", ")}`,
    );
  }

  return raw;
}

// ─── per-row validation ──────────────────────────────────────────────────────

function validateRows(raw: RawRow[]): ParseResult {
  const validRows: ValidRow[] = [];
  const errors: AdminProductImportRowError[] = [];

  // Track in-file duplicates so a second occurrence is reported, not silently merged.
  const seenSlugs = new Map<string, number>();
  const seenSkus = new Map<string, number>();

  raw.forEach((r, i) => {
    const row = i + 1;
    const msgs: string[] = [];
    const slug = (r.slug ?? "").trim();

    if (!slug) msgs.push("slug is required");
    else if (!/^[a-z0-9-]+$/.test(slug))
      msgs.push("slug must be lowercase letters, numbers, hyphens only");
    else if (seenSlugs.has(slug))
      msgs.push(`duplicate slug in file (also row ${seenSlugs.get(slug)})`);

    const nameEn = (r.name_en ?? "").trim();
    if (!nameEn) msgs.push("name_en is required");

    const collection = (r.collection ?? "").trim() as Collection;
    if (!COLLECTIONS.has(collection))
      msgs.push(`collection must be one of ${[...COLLECTIONS].join("|")}`);

    const tierRaw = (r.tier ?? "").trim();
    let tier: Tier | null = null;
    if (tierRaw) {
      if (!TIERS.has(tierRaw as Tier))
        msgs.push(`tier must be blank or one of ${[...TIERS].join("|")}`);
      else tier = tierRaw as Tier;
    }

    const family = (r.family ?? "").trim() as Family;
    if (!FAMILIES.has(family))
      msgs.push(`family must be one of ${[...FAMILIES].join("|")}`);

    const intensityRaw = (r.intensity ?? "").trim();
    let intensity: any = null;
    if (intensityRaw) {
      if (!INTENSITIES.has(intensityRaw))
        msgs.push(`intensity must be blank or one of ${[...INTENSITIES].join("|")}`);
      else intensity = intensityRaw;
    }

    let longevity = 5;
    if (r.longevity && r.longevity.trim()) {
      const v = intInRange(r.longevity, 1, 10);
      if (v === null) msgs.push("longevity must be an integer 1–10");
      else longevity = v;
    }
    let sillage = 5;
    if (r.sillage && r.sillage.trim()) {
      const v = intInRange(r.sillage, 1, 10);
      if (v === null) msgs.push("sillage must be an integer 1–10");
      else sillage = v;
    }

    const moods = splitList(r.moods) as Mood[];
    const badMoods = moods.filter((m) => !MOODS.has(m));
    if (badMoods.length) msgs.push(`invalid moods: ${badMoods.join(", ")}`);

    const occasions = splitList(r.occasions) as Occasion[];
    const badOcc = occasions.filter((o) => !OCCASIONS.has(o));
    if (badOcc.length) msgs.push(`invalid occasions: ${badOcc.join(", ")}`);

    // Per-variant image URLs: size-specific column wins, else shared `images`.
    const sharedImages = splitList(r.images);
    const variantImages = (sizeMl: number): string[] => {
      const sized = splitList(r[`images_${sizeMl}`]);
      return sized.length > 0 ? sized : sharedImages;
    };

    // variants (fixed 50ml / 100ml)
    const variants: VariantSpec[] = [];
    const variantInputs: Array<{
      sizeMl: number;
      sku?: string;
      price?: string;
      stock?: string;
      weight?: string;
    }> = [
      { sizeMl: 50, sku: r.sku_50, price: r.price_50, stock: r.stock_50, weight: r.weight_50 },
      { sizeMl: 100, sku: r.sku_100, price: r.price_100, stock: r.stock_100, weight: r.weight_100 },
    ];
    for (const vi of variantInputs) {
      const sku = (vi.sku ?? "").trim();
      if (!sku) continue;
      if (seenSkus.has(sku))
        msgs.push(`duplicate sku "${sku}" in file (also row ${seenSkus.get(sku)})`);
      else seenSkus.set(sku, row);
      const price = rupeesToPaise(vi.price);
      if (price === null)
        msgs.push(`price_${vi.sizeMl} must be a non-negative rupee amount`);
      const stock = vi.stock && vi.stock.trim() ? intInRange(vi.stock, 0, 1_000_000) : 0;
      if (stock === null) msgs.push(`stock_${vi.sizeMl} must be a non-negative integer`);

      // Optional packaged weight in grams; blank → null (DEFAULT_PACKAGE fallback).
      let weightGrams: number | null = null;
      if (vi.weight && vi.weight.trim()) {
        weightGrams = intInRange(vi.weight, 1, 100_000);
        if (weightGrams === null)
          msgs.push(`weight_${vi.sizeMl} must be a positive integer (grams)`);
      }

      const imageUrls = variantImages(vi.sizeMl);
      const badUrls = imageUrls.filter((u) => !isHttpUrl(u));
      if (badUrls.length)
        msgs.push(`image URLs must start with http(s): ${badUrls.join(", ")}`);
      // Images are optional at import: a variant may instead receive its
      // image(s) via manual upload in the wizard. The wizard enforces
      // >=1 image per variant (counting manual uploads) before saving.

      if (price !== null && stock !== null) {
        variants.push({ sku, sizeMl: vi.sizeMl, price, stock, weightGrams, imageUrls });
      }
    }
    if (variants.length === 0 && !msgs.some((m) => m.startsWith("price") || m.startsWith("stock")))
      msgs.push("at least one variant required (sku_50 or sku_100)");

    if (slug && !seenSlugs.has(slug)) seenSlugs.set(slug, row);

    if (msgs.length > 0) {
      errors.push({ row, slug: slug || null, messages: msgs });
      return;
    }

    validRows.push({
      row,
      slug,
      name: { en: nameEn, ar: (r.name_ar ?? "").trim() },
      description: {
        en: (r.description_en ?? "").trim(),
        ar: (r.description_ar ?? "").trim(),
      },
      collection,
      tier,
      family,
      intensity,
      longevity,
      sillage,
      topNotes: { en: splitList(r.top_notes_en), ar: splitList(r.top_notes_ar) },
      heartNotes: { en: splitList(r.heart_notes_en), ar: splitList(r.heart_notes_ar) },
      baseNotes: { en: splitList(r.base_notes_en), ar: splitList(r.base_notes_ar) },
      moods,
      occasions,
      isFeatured: truthy(r.is_featured),
      isActive: r.is_active === undefined || r.is_active === "" ? true : truthy(r.is_active),
      variants,
    });
  });

  return { totalRows: raw.length, validRows, errors };
}

// ─── classify against DB (existing slug / sku collisions) ────────────────────

interface SkippedRow {
  row: number;
  slug: string;
}

interface Classified {
  toCreate: ValidRow[];
  /** rows ignored because slug OR sku already exists in the DB. */
  skipped: SkippedRow[];
}

/**
 * Split valid rows into ones to create vs ones already present in the DB.
 * Anything whose slug already exists, or whose sku is already taken, is
 * SKIPPED (never an error) — existing records are left untouched; the admin
 * can edit them manually from the dashboard.
 */
async function classify(validRows: ValidRow[]): Promise<Classified> {
  if (validRows.length === 0) {
    return { toCreate: [], skipped: [] };
  }

  const { existingSlugs, takenSkus } = await fetchDbCollisions(
    validRows.map((r) => r.slug),
    validRows.flatMap((r) => r.variants.map((v) => v.sku)),
  );

  const skipped: SkippedRow[] = [];
  const toCreate = validRows.filter((r) => {
    const slugTaken = existingSlugs.has(r.slug);
    const skuTaken = r.variants.some((v) => takenSkus.has(v.sku));
    if (slugTaken || skuTaken) {
      skipped.push({ row: r.row, slug: r.slug });
      return false;
    }
    return true;
  });

  return { toCreate, skipped };
}

/** Query the DB once for which of these slugs/skus already exist. */
async function fetchDbCollisions(
  slugs: string[],
  skus: string[],
): Promise<{ existingSlugs: Set<string>; takenSkus: Set<string> }> {
  const cleanSlugs = slugs.filter(Boolean);
  const cleanSkus = skus.filter(Boolean);

  const existingSlugs = new Set<string>();
  if (cleanSlugs.length > 0) {
    const rows = await prisma.product.findMany({
      where: { slug: { in: cleanSlugs } },
      select: { slug: true },
    });
    for (const r of rows) existingSlugs.add(r.slug);
  }

  const takenSkus = new Set<string>();
  if (cleanSkus.length > 0) {
    const rows = await prisma.productVariant.findMany({
      where: { sku: { in: cleanSkus } },
      select: { sku: true },
    });
    for (const r of rows) takenSkus.add(r.sku);
  }

  return { existingSlugs, takenSkus };
}

/** Pull slug + sku cells straight from a raw row (pre-validation). */
function rawSlug(cells: RawRow): string {
  return (cells.slug ?? "").trim();
}
function rawSkus(cells: RawRow): string[] {
  return [cells.sku_50, cells.sku_100]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
}

/**
 * Does this raw row collide with an existing DB product/variant by slug or sku?
 * Works regardless of whether the row passes validation, so an invalid row that
 * targets an already-existing record is still recognised as "skip", not "error".
 */
async function rawRowExists(cells: RawRow): Promise<boolean> {
  const slug = rawSlug(cells);
  const skus = rawSkus(cells);
  if (!slug && skus.length === 0) return false;
  const { existingSlugs, takenSkus } = await fetchDbCollisions([slug], skus);
  return existingSlugs.has(slug) || skus.some((s) => takenSkus.has(s));
}

// ─── per-row preview status (new / skipped / error) ──────────────────────────

/**
 * Map each raw row to a status + messages by running validation + DB classify.
 * Rows are echoed back (cells) so the UI can prefill an editable form per row.
 */
async function buildPreviewRows(
  raw: RawRow[],
): Promise<AdminProductImportPreviewRow[]> {
  const { errors } = validateRows(raw);

  // DB collisions computed from RAW cells across every row (not just valid
  // ones) so an invalid row pointing at an existing record skips, not errors.
  const { existingSlugs, takenSkus } = await fetchDbCollisions(
    raw.map(rawSlug),
    raw.flatMap(rawSkus),
  );

  const errorByRow = new Map<number, string[]>();
  for (const e of errors) {
    errorByRow.set(e.row, [...(errorByRow.get(e.row) ?? []), ...e.messages]);
  }

  return raw.map((cells, i) => {
    const row = i + 1;
    const slug = rawSlug(cells) || null;
    const exists =
      (slug !== null && existingSlugs.has(slug)) ||
      rawSkus(cells).some((s) => takenSkus.has(s));
    const msgs = errorByRow.get(row);

    // "Already exists" wins over validation errors — skip, never error.
    let status: AdminProductImportPreviewRow["status"];
    if (exists) status = "skipped";
    else if (msgs && msgs.length > 0) status = "error";
    else status = "new";

    return {
      index: i,
      cells,
      slug,
      status,
      messages: exists ? [] : (msgs ?? []),
    };
  });
}

// ─── public: preview (dry run, no writes) ────────────────────────────────────

export async function preview(buffer: Buffer): Promise<AdminProductImportReport> {
  const raw = parseCsv(buffer);
  const rows = await buildPreviewRows(raw);
  // Count from the raw per-row statuses so a row that is BOTH invalid and
  // already-existing is counted as skipped (matches what the wizard hides).
  const skipped = rows
    .filter((r) => r.status === "skipped")
    .map((r) => ({ row: r.index + 1, slug: r.slug ?? "" }));
  const newSlugs = rows.filter((r) => r.status === "new").map((r) => r.slug ?? "");
  const errors = rows
    .filter((r) => r.status === "error")
    .map((r) => ({ row: r.index + 1, slug: r.slug, messages: r.messages }));
  return {
    totalRows: raw.length,
    created: newSlugs.length,
    skipped: skipped.length,
    errorCount: errors.length,
    newSlugs,
    skippedSlugs: skipped.map((s) => s.slug),
    errors,
    dryRun: true,
    rows,
  };
}

// ─── public: re-validate one edited row (no writes) ──────────────────────────

export async function validateOne(
  cells: AdminProductImportCells,
): Promise<AdminProductImportValidateRowResponse> {
  const [row] = await buildPreviewRows([cells]);
  return { status: row.status, slug: row.slug, messages: row.messages };
}

// ─── public: apply one edited row (inserts if NEW) ───────────────────────────

export async function applyOne(
  cells: AdminProductImportCells,
): Promise<AdminProductImportApplyRowResponse> {
  // Existing slug/sku → skip, before any validation. Existing records are
  // never an error; the admin edits them from the dashboard.
  if (await rawRowExists(cells)) {
    return {
      ok: false,
      slug: rawSlug(cells) || null,
      status: "skipped",
      messages: ["already exists (slug or sku) — skipped"],
    };
  }

  const { validRows, errors } = validateRows([cells]);
  if (errors.length > 0) {
    return { ok: false, slug: errors[0].slug, status: "error", messages: errors[0].messages };
  }
  const { toCreate } = await classify(validRows);
  if (toCreate.length === 0) {
    // Race: slug/sku appeared between the check above and now.
    return {
      ok: false,
      slug: rawSlug(cells) || null,
      status: "skipped",
      messages: ["already exists (slug or sku) — skipped"],
    };
  }
  const target = toCreate[0];
  try {
    // Insert product + variants first; CSV image links are fetched onto our
    // server afterwards so a slow/broken link never holds the DB transaction.
    const productId = await insertOne(target);
    const messages: string[] = [];
    const failed = await persistCsvImages(productId, target.variants);
    if (failed > 0) {
      messages.push(`${failed} image link(s) could not be downloaded`);
    }
    return { ok: true, productId, slug: target.slug, status: "new", messages };
  } catch (e) {
    return { ok: false, slug: target.slug, status: "error", messages: [insertErrorMessage(e)] };
  }
}

// ─── insert one valid row (product + variants + images) atomically ───────────

async function insertOne(r: ValidRow): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        slug: r.slug,
        name: r.name as unknown as Prisma.InputJsonValue,
        description: r.description as unknown as Prisma.InputJsonValue,
        collection: r.collection,
        tier: r.tier,
        family: r.family,
        intensity: r.intensity,
        longevity: r.longevity,
        sillage: r.sillage,
        topNotes: r.topNotes as unknown as Prisma.InputJsonValue,
        heartNotes: r.heartNotes as unknown as Prisma.InputJsonValue,
        baseNotes: r.baseNotes as unknown as Prisma.InputJsonValue,
        moods: r.moods,
        occasions: r.occasions,
        isFeatured: r.isFeatured,
        isActive: r.isActive,
      },
    });
    if (r.variants.length > 0) {
      await tx.productVariant.createMany({
        data: r.variants.map((v) => ({
          productId: product.id,
          sku: v.sku,
          sizeMl: v.sizeMl,
          price: v.price,
          stock: v.stock,
          weightGrams: v.weightGrams,
          isActive: true,
        })),
      });
    }
    // Images are re-hosted outside the transaction (slow network) and are
    // per-variant now, so they are created in persistCsvImages once variant
    // rows exist.
    return product.id;
  });
}

/** Translate an insert failure into a human message (P2002 = unique race). */
function insertErrorMessage(e: unknown): string {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
    ? "slug or sku conflict (created concurrently)"
    : e instanceof Error
      ? e.message
      : "insert failed";
}

// ─── download CSV image URLs onto our server ──────────────────────────────────

const IMAGE_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/**
 * Fetch a remote image URL (SSRF-hardened) and re-host it on Cloudinary under
 * jazor/products/<productId>. Returns the upload result, or null if the
 * fetch/validation failed (logged + skipped — one bad link must not abort the
 * whole product).
 */
async function downloadImage(
  url: string,
  productId: string,
): Promise<UploadResult | null> {
  try {
    const res = await safeFetch(url);
    if (!res.ok) {
      logger.warn("import image fetch failed", { url, status: res.status });
      return null;
    }
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!IMAGE_MIME_EXT[mime]) {
      logger.warn("import image bad mime", { url, mime });
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > IMAGE_DOWNLOAD_MAX_BYTES) {
      logger.warn("import image bad size", { url, bytes: buf.length });
      return null;
    }
    return await uploadBuffer(buf, `jazor/products/${productId}`);
  } catch (err) {
    logger.warn("import image download error", {
      url,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * For each variant's CSV image URLs, re-host on Cloudinary + create per-variant
 * ProductImage rows. Returns count of links that failed. Best-effort: never
 * throws. Matches variants by SKU against the freshly inserted rows.
 */
async function persistCsvImages(
  productId: string,
  variants: VariantSpec[],
): Promise<number> {
  const rows = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, sku: true },
  });
  const idBySku = new Map(rows.map((r) => [r.sku, r.id]));

  let failed = 0;
  for (const v of variants) {
    const variantId = idBySku.get(v.sku);
    if (!variantId) continue;
    let position = 0;
    for (const url of v.imageUrls) {
      const uploaded = await downloadImage(url, productId);
      if (!uploaded) {
        failed++;
        continue;
      }
      await prisma.productImage.create({
        data: {
          variantId,
          url: uploaded.url,
          publicId: uploaded.publicId,
          position: position++,
        },
      });
    }
  }
  return failed;
}

// ─── public: downloadable template CSV ───────────────────────────────────────

export function templateCsv(): string {
  const header = IMPORT_COLUMNS.join(",");
  const example = [
    "oud-royale",
    "Oud Royale",
    "عود رويال",
    "A regal oud composition.",
    "تركيبة عود ملكية",
    "ARABIC",
    "SIGNATURE",
    "OUD",
    "STRONG",
    "9",
    "8",
    '"Saffron,Bergamot"',
    '"زعفران,برغموت"',
    '"Rose,Oud"',
    '"ورد,عود"',
    '"Amber,Musk"',
    '"عنبر,مسك"',
    '"MYSTERIOUS,CONFIDENT"',
    '"EVENING,SPECIAL"',
    "true",
    "true",
    "JZ-OR-50",
    "2499",
    "20",
    "250",
    "JZ-OR-100",
    "4499",
    "15",
    "400",
    '"https://example.com/oud-royale.jpg"',
    '"https://example.com/oud-royale-50.jpg"',
    '"https://example.com/oud-royale-100.jpg"',
  ].join(",");
  return `${header}\n${example}\n`;
}
