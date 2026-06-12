import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/prisma.js";
import type { Collection, Family } from "@prisma/client";

let counter = 0;
function uniq(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export interface MakeUserOpts {
  email?: string;
  password?: string;
  role?: "CUSTOMER" | "ADMIN";
  verified?: boolean;
}

export async function makeUser(opts: MakeUserOpts = {}) {
  const password = opts.password ?? "Password123!";
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `${uniq("user")}@jazor.test`,
      passwordHash,
      role: opts.role ?? "CUSTOMER",
      // Verified by default — login now requires a verified email, and most
      // tests just want an authenticatable user. Pass verified:false to opt out.
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      name: "Test User",
    },
  });
  return { ...user, password };
}

export interface MakeProductOpts {
  name?: string;
  collection?: Collection;
  family?: Family;
  price?: number;
  stock?: number;
  sku?: string;
}

export async function makeProduct(opts: MakeProductOpts = {}) {
  const slug = uniq("product");
  const product = await prisma.product.create({
    data: {
      slug,
      name: { en: opts.name ?? "Test Perfume", ar: "اختبار" },
      description: { en: "desc", ar: "وصف" },
      collection: opts.collection ?? "FRENCH",
      family: opts.family ?? "FLORAL",
      longevity: 7,
      sillage: 7,
      topNotes: { en: ["rose"], ar: ["ورد"] },
      heartNotes: { en: ["jasmine"], ar: ["ياسمين"] },
      baseNotes: { en: ["musk"], ar: ["مسك"] },
      moods: ["CONFIDENT"],
      occasions: ["DAY"],
      variants: {
        create: {
          sku: opts.sku ?? uniq("SKU").toUpperCase(),
          sizeMl: 50,
          price: opts.price ?? 100000,
          stock: opts.stock ?? 10,
        },
      },
      images: {
        create: { url: "/uploads/test.png", position: 0 },
      },
    },
    include: { variants: true },
  });
  return product;
}

export async function makePromotion(opts: {
  name?: string;
  rewardType?: "PERCENT" | "FLAT" | "FREE_SHIPPING" | "BUY_X_GET_Y";
  applyMode?: "AUTOMATIC" | "CODE";
  code?: string;
  value?: number;
  buyQty?: number;
  getQty?: number;
  minOrderPrice?: number;
  maxUses?: number;
  perUserLimit?: number;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  isActive?: boolean;
  giftVariantIds?: string[];
} = {}) {
  const rewardType = opts.rewardType ?? "PERCENT";
  const applyMode = opts.applyMode ?? "CODE";
  return prisma.promotion.create({
    data: {
      name: opts.name ?? uniq("Promo"),
      rewardType,
      applyMode,
      code: applyMode === "CODE" ? (opts.code ?? uniq("DISC").toUpperCase()) : null,
      value: opts.value ?? (rewardType === "PERCENT" ? 10 : 0),
      buyQty: opts.buyQty ?? 0,
      getQty: opts.getQty ?? 0,
      minOrderPrice: opts.minOrderPrice ?? 0,
      maxUses: opts.maxUses ?? 0,
      perUserLimit: opts.perUserLimit ?? 0,
      startsAt: opts.startsAt ?? null,
      expiresAt: opts.expiresAt ?? null,
      isActive: opts.isActive ?? true,
      giftProducts: opts.giftVariantIds?.length
        ? { create: opts.giftVariantIds.map((variantId) => ({ variantId })) }
        : undefined,
    },
  });
}

export async function addCartItem(userId: string, variantId: string, qty = 1) {
  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, qty },
    update: { qty },
  });
  return cart;
}

export const validAddress = {
  contactName: "Buyer One",
  phone: "9999999999",
  line1: "1 Test Street",
  line2: "Apt 1",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  country: "India",
};
