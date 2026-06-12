import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { uploadBuffer, destroy } from "../lib/cloudinary.js";
import type { AdminImageDto, AdminImageUpdateRequest } from "../types/admin.js";
import type { I18nString } from "../types/products.js";

function jsonToI18nNullable(v: Prisma.JsonValue | null | undefined): I18nString | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    en: typeof o.en === "string" ? o.en : "",
    ar: typeof o.ar === "string" ? o.ar : "",
  };
}

function toDto(img: {
  id: string;
  url: string;
  alt: Prisma.JsonValue | null;
  position: number;
}): AdminImageDto {
  return {
    id: img.id,
    url: img.url,
    alt: jsonToI18nNullable(img.alt),
    position: img.position,
  };
}

interface UploadedFile {
  buffer: Buffer;
  productId: string;
  altEn?: string;
  altAr?: string;
}

export async function uploadOne(input: UploadedFile): Promise<AdminImageDto> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

  const maxPos = await prisma.productImage.aggregate({
    where: { productId: input.productId },
    _max: { position: true },
  });
  const nextPos = (maxPos._max.position ?? -1) + 1;

  const { url, publicId } = await uploadBuffer(
    input.buffer,
    `jazor/products/${input.productId}`,
  );
  const alt =
    input.altEn || input.altAr
      ? ({
          en: input.altEn ?? "",
          ar: input.altAr ?? "",
        } as Prisma.InputJsonValue)
      : undefined;

  const img = await prisma.productImage.create({
    data: {
      productId: input.productId,
      url,
      publicId,
      alt,
      position: nextPos,
    },
  });
  return toDto(img);
}

export async function updateImage(
  imageId: string,
  input: AdminImageUpdateRequest,
): Promise<AdminImageDto> {
  const existing = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true },
  });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Image not found");

  const data: Prisma.ProductImageUpdateInput = {};
  if (input.position !== undefined) data.position = input.position;
  if (input.alt !== undefined) {
    data.alt =
      input.alt === null
        ? Prisma.JsonNull
        : (input.alt as unknown as Prisma.InputJsonValue);
  }
  const img = await prisma.productImage.update({ where: { id: imageId }, data });
  return toDto(img);
}

export async function removeImage(imageId: string): Promise<{ id: string }> {
  const img = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, publicId: true },
  });
  if (!img) throw new HttpError(404, "NOT_FOUND", "Image not found");

  await prisma.productImage.delete({ where: { id: imageId } });

  if (img.publicId) await destroy(img.publicId);
  return { id: imageId };
}
