import type { Request, Response } from "express";
import { z } from "zod";
import * as productsService from "../services/productsService.js";
import { ok } from "../utils/respond.js";
import type {
  ProductDetailDto,
  ProductListResponse,
  RelatedProductsResponse,
  ReviewListResponse,
} from "../types/products.js";

const listQuerySchema = z
  .object({
    collection: z.enum(["FRENCH", "ARABIC"]).optional(),
    tier: z.enum(["SIGNATURE", "DARK"]).optional(),
    family: z
      .enum(["FLORAL", "WOODY", "ORIENTAL", "FRESH", "OUD", "AMBER", "CITRUS", "AQUATIC", "GOURMAND"])
      .optional(),
    q: z.string().trim().min(1).max(80).optional(),
    minPrice: z.coerce.number().int().nonnegative().optional(),
    maxPrice: z.coerce.number().int().nonnegative().optional(),
    sort: z
      .enum(["newest", "priceAsc", "priceDesc", "featured"])
      .default("featured"),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(24),
  })
  .refine((v) => v.minPrice == null || v.maxPrice == null || v.minPrice <= v.maxPrice, {
    path: ["minPrice"],
    message: "minPrice must be less than or equal to maxPrice",
  });

const slugParam = z.object({ slug: z.string().min(1).max(80) });

const reviewsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(["newest", "highRated", "lowRated"]).default("newest"),
});

export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  const data = await productsService.list(query);
  ok<ProductListResponse>(res, data);
}

export async function detail(req: Request, res: Response) {
  const { slug } = slugParam.parse(req.params);
  const data = await productsService.detail(slug);
  ok<ProductDetailDto>(res, data);
}

export async function reviews(req: Request, res: Response) {
  const { slug } = slugParam.parse(req.params);
  const query = reviewsQuerySchema.parse(req.query);
  const data = await productsService.reviews(slug, query);
  ok<ReviewListResponse>(res, data);
}

export async function related(req: Request, res: Response) {
  const { slug } = slugParam.parse(req.params);
  const data = await productsService.related(slug);
  ok<RelatedProductsResponse>(res, data);
}
