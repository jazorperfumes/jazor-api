import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type { CartDto, CartItemDto } from "../types/cart.js";
import type { I18nString } from "../types/products.js";

type PrismaCartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        variant: {
          include: {
            product: { include: { images: true } };
          };
        };
      };
    };
  };
}>;

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: {
          product: { include: { images: true } },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

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

function toCartItemDto(item: PrismaCartWithItems["items"][number]): CartItemDto {
  const variant = item.variant;
  const product = variant.product;
  const primary = product.images.slice().sort((a, b) => a.position - b.position)[0];
  const inStock =
    variant.isActive &&
    variant.deletedAt == null &&
    product.isActive &&
    product.deletedAt == null &&
    variant.stock > 0;
  return {
    id: item.id,
    variantId: variant.id,
    productId: product.id,
    slug: product.slug,
    name: jsonToI18n(product.name),
    image: primary?.url ?? null,
    collection: product.collection,
    family: product.family,
    sizeMl: variant.sizeMl,
    sku: variant.sku,
    unitPrice: variant.price,
    qty: item.qty,
    lineTotal: variant.price * item.qty,
    inStock,
    availableStock: variant.stock,
  };
}

function toCartDto(cart: PrismaCartWithItems): CartDto {
  const items = cart.items.map(toCartItemDto);
  return {
    id: cart.id,
    items,
    subtotalPrice: items.reduce((s, i) => s + i.lineTotal, 0),
    itemCount: items.reduce((s, i) => s + i.qty, 0),
    updatedAt: cart.updatedAt.toISOString(),
  };
}

async function loadOrCreate(userId: string): Promise<PrismaCartWithItems> {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    include: cartInclude,
  });
}

export async function getCart(userId: string): Promise<CartDto> {
  const cart = await loadOrCreate(userId);
  return toCartDto(cart);
}

const MAX_CART_QTY = 10;

export async function addItem(
  userId: string,
  variantId: string,
  qty: number,
): Promise<CartDto> {
  const variant = await prisma.productVariant.findFirst({
    where: {
      id: variantId,
      isActive: true,
      deletedAt: null,
      product: { isActive: true, deletedAt: null },
    },
    select: { id: true },
  });
  if (!variant) throw new HttpError(404, "NOT_FOUND", "Variant not found");

  const cart = await loadOrCreate(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    select: { qty: true },
  });
  const nextQty = (existing?.qty ?? 0) + qty;
  if (nextQty > MAX_CART_QTY) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `Max ${MAX_CART_QTY} per item`,
      { max: MAX_CART_QTY, requested: nextQty },
    );
  }
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, qty },
    update: { qty: { increment: qty } },
  });
  await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });

  return getCart(userId);
}

async function loadOwnedItem(userId: string, itemId: string) {
  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    select: { id: true, cart: { select: { userId: true } } },
  });
  // 404 (not 403) avoids leaking existence of items owned by other users.
  if (!item || item.cart.userId !== userId) {
    throw new HttpError(404, "NOT_FOUND", "Cart item not found");
  }
  return item;
}

export async function updateItemQty(
  userId: string,
  itemId: string,
  qty: number,
): Promise<CartDto> {
  await loadOwnedItem(userId, itemId);
  await prisma.cartItem.update({ where: { id: itemId }, data: { qty } });
  return getCart(userId);
}

export async function removeItem(userId: string, itemId: string): Promise<CartDto> {
  await loadOwnedItem(userId, itemId);
  await prisma.cartItem.delete({ where: { id: itemId } });
  return getCart(userId);
}

export async function clearCart(userId: string): Promise<CartDto> {
  const cart = await loadOrCreate(userId);
  if (cart.items.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }
  return getCart(userId);
}
