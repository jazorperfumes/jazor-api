/**
 * Comprehensive seed:
 *   npx prisma db seed
 *   tsx prisma/seed.ts
 *
 * Populates every table needed for manual + E2E testing:
 *   products / variants / images (from CSV)
 *   users (admin + customers), addresses
 *   pickup address, discounts
 *   wishlist, cart + items (user + guest)
 *   orders across statuses (CREATED / PAID / DELIVERED / CANCELLED),
 *   order events, payments, shipments + events, discount redemption
 *   reviews on delivered items (verified-purchase)
 *   inventory adjustments
 *   contact messages, newsletter subs, settings, webhook events
 *
 * Idempotent: re-runs are safe.
 */
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import bcrypt from "bcryptjs";
import {
  PrismaClient,
  Prisma,
  Collection,
  Tier,
  Family,
  Mood,
  Occasion,
  UserRole,
  PromotionRewardType,
  PromotionApplyMode,
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
  ReviewStatus,
} from "@prisma/client";

const prisma = new PrismaClient();
const CSV_PATH = "prisma/seed/products.template.csv";

// ─── csv types + helpers ───────────────────────────────────────────────────

interface Row {
  slug: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  collection: string;
  tier: string;
  family: string;
  longevity: string;
  sillage: string;
  top_notes_en: string;
  top_notes_ar: string;
  heart_notes_en: string;
  heart_notes_ar: string;
  base_notes_en: string;
  base_notes_ar: string;
  moods: string;
  occasions: string;
  is_featured: string;
  is_active: string;
  sku_50: string;
  price_50: string;
  stock_50: string;
  sku_100: string;
  price_100: string;
  stock_100: string;
  images: string;
  images_50?: string;
  images_100?: string;
}

const splitList = (s: string): string[] =>
  s.split(",").map((x) => x.trim()).filter(Boolean);

const truthy = (s: string): boolean =>
  s === "true" || s === "TRUE" || s === "1";

const intOr = (s: string, fallback: number): number => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
};

const daysAgo = (d: number): Date =>
  new Date(Date.now() - d * 24 * 60 * 60 * 1000);

// ─── 1) products + variants + images ───────────────────────────────────────

async function seedProducts() {
  const csv = readFileSync(CSV_PATH, "utf8");
  const rows: Row[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  let created = 0;
  let updated = 0;
  let variantsUpserted = 0;
  let imagesReplaced = 0;

  for (const r of rows) {
    const existing = await prisma.product.findUnique({
      where: { slug: r.slug },
      select: { id: true },
    });

    const data = {
      slug: r.slug,
      name: { en: r.name_en, ar: r.name_ar },
      description: { en: r.description_en, ar: r.description_ar },
      collection: r.collection as Collection,
      tier: r.tier && r.tier.trim() ? (r.tier.trim() as Tier) : null,
      family: r.family as Family,
      longevity: intOr(r.longevity, 5),
      sillage: intOr(r.sillage, 5),
      topNotes: { en: splitList(r.top_notes_en), ar: splitList(r.top_notes_ar) },
      heartNotes: { en: splitList(r.heart_notes_en), ar: splitList(r.heart_notes_ar) },
      baseNotes: { en: splitList(r.base_notes_en), ar: splitList(r.base_notes_ar) },
      moods: splitList(r.moods) as Mood[],
      occasions: splitList(r.occasions) as Occasion[],
      isFeatured: truthy(r.is_featured),
      isActive: r.is_active === "" ? true : truthy(r.is_active),
    };

    const product = await prisma.product.upsert({
      where: { slug: r.slug },
      create: data,
      update: data,
    });

    if (existing) updated++;
    else created++;

    const variantSpecs: Array<{ sku: string; sizeMl: number; price: number; stock: number }> = [];
    if (r.sku_50) {
      variantSpecs.push({
        sku: r.sku_50,
        sizeMl: 50,
        price: intOr(r.price_50, 0),
        stock: intOr(r.stock_50, 0),
      });
    }
    if (r.sku_100) {
      variantSpecs.push({
        sku: r.sku_100,
        sizeMl: 100,
        price: intOr(r.price_100, 0),
        stock: intOr(r.stock_100, 0),
      });
    }

    const sharedImages = splitList(r.images);
    const imagesFor = (sizeMl: number): string[] => {
      const sized = splitList(
        sizeMl === 50 ? (r.images_50 ?? "") : (r.images_100 ?? ""),
      );
      return sized.length > 0 ? sized : sharedImages;
    };

    for (const v of variantSpecs) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        create: { ...v, productId: product.id, isActive: true },
        update: {
          sizeMl: v.sizeMl,
          price: v.price,
          stock: v.stock,
          productId: product.id,
          isActive: true,
          deletedAt: null,
        },
      });
      variantsUpserted++;

      // Images are per-variant; replace this variant's set on each seed run.
      const urls = imagesFor(v.sizeMl);
      await prisma.productImage.deleteMany({ where: { variantId: variant.id } });
      if (urls.length > 0) {
        await prisma.productImage.createMany({
          data: urls.map((url, i) => ({
            variantId: variant.id,
            url,
            position: i,
          })),
        });
        imagesReplaced += urls.length;
      }
    }
  }

  return { products: rows.length, created, updated, variantsUpserted, imagesReplaced };
}

// ─── 2) users + addresses ──────────────────────────────────────────────────

interface SeedUser {
  email: string;
  name: string;
  phone: string;
  role: UserRole;
  password: string;
  verified: boolean;
}

const SEED_USERS: SeedUser[] = [
  { email: "admin@jazor.test", name: "Jazor Admin", phone: "+919999900001", role: UserRole.ADMIN, password: "admin12345", verified: true },
  { email: "alice@jazor.test", name: "Alice Sharma", phone: "+919999900002", role: UserRole.CUSTOMER, password: "password123", verified: true },
  { email: "bob@jazor.test", name: "Bob Mehta", phone: "+919999900003", role: UserRole.CUSTOMER, password: "password123", verified: true },
  { email: "carol@jazor.test", name: "Carol Khan", phone: "+919999900004", role: UserRole.CUSTOMER, password: "password123", verified: false },
];

async function seedUsers() {
  const ids: Record<string, string> = {};
  for (const u of SEED_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        passwordHash,
        name: u.name,
        phone: u.phone,
        role: u.role,
        emailVerifiedAt: u.verified ? new Date() : null,
      },
      update: {
        name: u.name,
        phone: u.phone,
        role: u.role,
        emailVerifiedAt: u.verified ? new Date() : null,
      },
    });
    ids[u.email] = user.id;
  }
  return ids;
}

async function seedAddresses(userIds: Record<string, string>) {
  const specs = [
    {
      userId: userIds["alice@jazor.test"],
      label: "Home",
      contactName: "Alice Sharma",
      phone: "+919999900002",
      line1: "12B Pali Hill",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400050",
      isDefaultShipping: true,
    },
    {
      userId: userIds["bob@jazor.test"],
      label: "Home",
      contactName: "Bob Mehta",
      phone: "+919999900003",
      line1: "44 Indiranagar 100ft Rd",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560038",
      isDefaultShipping: true,
    },
    {
      userId: userIds["carol@jazor.test"],
      label: "Office",
      contactName: "Carol Khan",
      phone: "+919999900004",
      line1: "5 DLF Phase 2",
      city: "Gurugram",
      state: "Haryana",
      pincode: "122002",
      isDefaultShipping: true,
    },
  ];

  for (const a of specs) {
    const exists = await prisma.address.findFirst({
      where: { userId: a.userId, line1: a.line1 },
      select: { id: true },
    });
    if (exists) {
      await prisma.address.update({ where: { id: exists.id }, data: a });
    } else {
      await prisma.address.create({ data: a });
    }
  }
}

// ─── 3) pickup address ─────────────────────────────────────────────────────

async function seedPickupAddress() {
  const existing = await prisma.pickupAddress.findFirst({
    where: { label: "Mumbai HQ" },
    select: { id: true },
  });
  const data = {
    label: "Mumbai HQ",
    contactName: "Jazor Warehouse",
    phone: "+912240000000",
    line1: "Plot 7, Andheri MIDC",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400093",
    isDefault: true,
  };
  if (existing) {
    return prisma.pickupAddress.update({ where: { id: existing.id }, data });
  }
  return prisma.pickupAddress.create({ data });
}

// ─── 4) promotions ─────────────────────────────────────────────────────────

interface PromoRef {
  id: string;
  rewardType: PromotionRewardType;
  code: string | null;
}

async function seedPromotions(): Promise<Record<string, PromoRef>> {
  // Two gift variants for the BUY_X_GET_Y pool.
  const giftVariants = await prisma.productVariant.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true },
    orderBy: { price: "asc" },
    take: 2,
  });

  // ① influencer code (once per user), ② limited flat code (500 uses),
  // ③ seasonal banner (auto 20%), ④ free shipping (auto), ⑤ BxGy (auto).
  const specs: Array<Prisma.PromotionCreateInput & { key: string }> = [
    {
      key: "WELCOME10",
      name: "Influencer 10% (once per user)",
      rewardType: PromotionRewardType.PERCENT,
      applyMode: PromotionApplyMode.CODE,
      code: "WELCOME10",
      value: 10,
      minOrderPrice: 100000,
      perUserLimit: 1,
    },
    {
      key: "FLAT500",
      name: "Flat ₹500 off (limited 500 uses)",
      rewardType: PromotionRewardType.FLAT,
      applyMode: PromotionApplyMode.CODE,
      code: "FLAT500",
      value: 50000,
      minOrderPrice: 200000,
      maxUses: 500,
    },
    {
      key: "SEASONAL20",
      name: "Seasonal sale 20%",
      rewardType: PromotionRewardType.PERCENT,
      applyMode: PromotionApplyMode.AUTOMATIC,
      value: 20,
      priority: 10,
      showBanner: true,
      bannerText: { en: "Seasonal offer — 20% off every product", ar: "عرض موسمي — خصم 20٪ على كل المنتجات" },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      key: "FREESHIP",
      name: "Free shipping over ₹1999",
      rewardType: PromotionRewardType.FREE_SHIPPING,
      applyMode: PromotionApplyMode.AUTOMATIC,
      minOrderPrice: 199900,
      priority: 90,
    },
    {
      key: "BXGY",
      name: "Buy 2 perfumes, choose 1 free",
      rewardType: PromotionRewardType.BUY_X_GET_Y,
      applyMode: PromotionApplyMode.AUTOMATIC,
      buyQty: 2,
      getQty: 1,
      priority: 50,
      ...(giftVariants.length > 0
        ? { giftProducts: { create: giftVariants.map((v) => ({ variantId: v.id })) } }
        : {}),
    },
  ];

  const out: Record<string, PromoRef> = {};
  for (const { key, ...data } of specs) {
    const existing = data.code
      ? await prisma.promotion.findUnique({ where: { code: data.code }, select: { id: true } })
      : await prisma.promotion.findFirst({ where: { name: data.name }, select: { id: true } });
    const p = existing
      ? await prisma.promotion.update({ where: { id: existing.id }, data })
      : await prisma.promotion.create({ data });
    out[key] = { id: p.id, rewardType: p.rewardType, code: p.code };
  }
  return out;
}

// ─── 5) wishlist + cart ────────────────────────────────────────────────────

async function seedWishlist(userIds: Record<string, string>) {
  const products = await prisma.product.findMany({ select: { id: true, slug: true } });
  const by = (s: string) => products.find((p) => p.slug === s)?.id;
  const items = [
    { userId: userIds["alice@jazor.test"], productId: by("keravelle") },
    { userId: userIds["alice@jazor.test"], productId: by("oud-al-jazor") },
    { userId: userIds["bob@jazor.test"], productId: by("embre-jazor") },
  ].filter((x) => x.productId);

  for (const i of items) {
    await prisma.wishlistItem.upsert({
      where: { userId_productId: { userId: i.userId!, productId: i.productId! } },
      create: i as { userId: string; productId: string },
      update: {},
    });
  }
}

async function seedCarts(userIds: Record<string, string>) {
  const variants = await prisma.productVariant.findMany({ select: { id: true, sku: true } });
  const bySku = (s: string) => variants.find((v) => v.sku === s)?.id;

  // user cart: bob
  const bobCart = await prisma.cart.upsert({
    where: { userId: userIds["bob@jazor.test"] },
    create: { userId: userIds["bob@jazor.test"] },
    update: {},
  });
  const bobItems = [
    { sku: "JZ-BAR-100", qty: 1 },
    { sku: "JZ-TRV-50", qty: 2 },
  ];
  for (const i of bobItems) {
    const variantId = bySku(i.sku);
    if (!variantId) continue;
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: bobCart.id, variantId } },
      create: { cartId: bobCart.id, variantId, qty: i.qty },
      update: { qty: i.qty },
    });
  }

  // guest cart
  const guestSessionId = "seed-guest-session-001";
  const guestCart = await prisma.cart.upsert({
    where: { sessionId: guestSessionId },
    create: { sessionId: guestSessionId },
    update: {},
  });
  const guestVariantId = bySku("JZ-KER-50");
  if (guestVariantId) {
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: guestCart.id, variantId: guestVariantId } },
      create: { cartId: guestCart.id, variantId: guestVariantId, qty: 1 },
      update: { qty: 1 },
    });
  }
}

// ─── 6) orders + items + events + payments + shipments + reviews ───────────

interface OrderSpec {
  orderNumber: string;
  userEmail: string;
  status: OrderStatus;
  daysAgo: number;
  items: Array<{ sku: string; qty: number }>;
  discountCode?: string;
  payment?: { status: PaymentStatus; method?: string };
  shipment?: { status: ShipmentStatus; awb: string };
  review?: { rating: number; title: string; body: string; status: ReviewStatus };
}

const ORDER_SPECS: OrderSpec[] = [
  {
    orderNumber: "JZ-2026-000001",
    userEmail: "alice@jazor.test",
    status: OrderStatus.DELIVERED,
    daysAgo: 30,
    items: [{ sku: "JZ-KER-100", qty: 1 }],
    discountCode: "WELCOME10",
    payment: { status: PaymentStatus.CAPTURED, method: "upi" },
    shipment: { status: ShipmentStatus.DELIVERED, awb: "AWB1000000001" },
    review: { rating: 5, title: "Truly regal", body: "Saffron and rose come through beautifully. Lasts all evening.", status: ReviewStatus.APPROVED },
  },
  {
    orderNumber: "JZ-2026-000002",
    userEmail: "alice@jazor.test",
    status: OrderStatus.DELIVERED,
    daysAgo: 14,
    items: [{ sku: "JZ-VDT-50", qty: 2 }],
    payment: { status: PaymentStatus.CAPTURED, method: "card" },
    shipment: { status: ShipmentStatus.DELIVERED, awb: "AWB1000000002" },
    review: { rating: 4, title: "Lovely Taif rose", body: "A bit sweet for daily but perfect for special occasions.", status: ReviewStatus.PENDING },
  },
  {
    orderNumber: "JZ-2026-000003",
    userEmail: "bob@jazor.test",
    status: OrderStatus.SHIPPED,
    daysAgo: 3,
    items: [{ sku: "JZ-BAR-100", qty: 1 }, { sku: "JZ-TRV-50", qty: 1 }],
    payment: { status: PaymentStatus.CAPTURED, method: "netbanking" },
    shipment: { status: ShipmentStatus.IN_TRANSIT, awb: "AWB1000000003" },
  },
  {
    orderNumber: "JZ-2026-000004",
    userEmail: "bob@jazor.test",
    status: OrderStatus.PAID,
    daysAgo: 1,
    items: [{ sku: "JZ-STL-50", qty: 1 }],
    payment: { status: PaymentStatus.CAPTURED, method: "upi" },
  },
  {
    orderNumber: "JZ-2026-000005",
    userEmail: "carol@jazor.test",
    status: OrderStatus.CREATED,
    daysAgo: 0,
    items: [{ sku: "JZ-AZI-50", qty: 1 }],
    payment: { status: PaymentStatus.CREATED },
  },
  {
    orderNumber: "JZ-2026-000006",
    userEmail: "carol@jazor.test",
    status: OrderStatus.CANCELLED,
    daysAgo: 7,
    items: [{ sku: "JZ-BRU-100", qty: 1 }],
    payment: { status: PaymentStatus.FAILED, method: "card" },
  },
];

async function seedOrders(userIds: Record<string, string>, promos: Record<string, PromoRef>, pickupAddressId: string) {
  const variants = await prisma.productVariant.findMany({
    include: {
      images: { orderBy: { position: "asc" }, take: 1 },
      product: true,
    },
  });
  const bySku = (s: string) => variants.find((v) => v.sku === s);

  for (const spec of ORDER_SPECS) {
    const existing = await prisma.order.findUnique({ where: { orderNumber: spec.orderNumber } });
    if (existing) continue; // idempotent

    const userId = userIds[spec.userEmail];
    const placedAt = daysAgo(spec.daysAgo);

    const itemRows = spec.items.map((i) => {
      const v = bySku(i.sku);
      if (!v) throw new Error(`variant ${i.sku} missing`);
      const name = (v.product.name as { en: string }).en;
      const lineTotal = v.price * i.qty;
      return {
        variantId: v.id,
        unitPrice: v.price,
        qty: i.qty,
        lineTotalPrice: lineTotal,
        productSnapshot: {
          name,
          slug: v.product.slug,
          image: v.images[0]?.url ?? null,
          sizeMl: v.sizeMl,
          sku: v.sku,
          collection: v.product.collection,
          family: v.product.family,
        },
      };
    });

    const subtotal = itemRows.reduce((a, b) => a + b.lineTotalPrice, 0);
    const promo = spec.discountCode ? promos[spec.discountCode] : undefined;
    const discountPrice =
      spec.discountCode === "WELCOME10"
        ? Math.floor(subtotal * 0.1)
        : spec.discountCode === "FLAT500"
          ? 50000
          : 0;
    const shippingPrice = subtotal >= 500000 ? 0 : 9900;
    const total = subtotal - discountPrice + shippingPrice;

    const shippingAddress = {
      contactName: SEED_USERS.find((u) => u.email === spec.userEmail)!.name,
      phone: SEED_USERS.find((u) => u.email === spec.userEmail)!.phone,
      line1: "Seed address line 1",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400050",
      country: "India",
    };

    const order = await prisma.order.create({
      data: {
        orderNumber: spec.orderNumber,
        userId,
        email: spec.userEmail,
        phone: shippingAddress.phone,
        status: spec.status,
        subtotalPrice: subtotal,
        discountPrice,
        shippingPrice,
        giftWrapPrice: 0,
        taxPrice: 0,
        totalPrice: total,
        currency: "INR",
        shippingAddress,
        placedAt,
        paidAt:
          spec.status === OrderStatus.PAID ||
          spec.status === OrderStatus.PACKED ||
          spec.status === OrderStatus.SHIPPED ||
          spec.status === OrderStatus.DELIVERED
            ? placedAt
            : null,
        cancelledAt: spec.status === OrderStatus.CANCELLED ? placedAt : null,
        items: { create: itemRows },
        events: {
          create: [
            { status: OrderStatus.CREATED, note: "order placed", createdAt: placedAt },
            ...(spec.status !== OrderStatus.CREATED && spec.status !== OrderStatus.CANCELLED
              ? [{ status: OrderStatus.PAID, note: "payment captured", createdAt: placedAt }]
              : []),
            ...(spec.status === OrderStatus.SHIPPED || spec.status === OrderStatus.DELIVERED
              ? [{ status: OrderStatus.SHIPPED, note: "handed to courier", createdAt: placedAt }]
              : []),
            ...(spec.status === OrderStatus.DELIVERED
              ? [{ status: OrderStatus.DELIVERED, note: "delivered", createdAt: placedAt }]
              : []),
            ...(spec.status === OrderStatus.CANCELLED
              ? [{ status: OrderStatus.CANCELLED, note: "payment failed", createdAt: placedAt }]
              : []),
          ],
        },
      },
      include: { items: true },
    });

    // payment
    if (spec.payment) {
      await prisma.payment.create({
        data: {
          orderId: order.id,
          provider: "razorpay",
          providerOrderId: `order_seed_${spec.orderNumber}`,
          providerPaymentId:
            spec.payment.status === PaymentStatus.CAPTURED ? `pay_seed_${spec.orderNumber}` : null,
          providerSignature:
            spec.payment.status === PaymentStatus.CAPTURED ? "seed-signature" : null,
          amountPrice: total,
          status: spec.payment.status,
          method: spec.payment.method,
          capturedAt: spec.payment.status === PaymentStatus.CAPTURED ? placedAt : null,
          errorCode: spec.payment.status === PaymentStatus.FAILED ? "BAD_CARD" : null,
          errorDescription: spec.payment.status === PaymentStatus.FAILED ? "Card declined" : null,
        },
      });
    }

    // shipment + events
    if (spec.shipment) {
      const shipment = await prisma.shipment.create({
        data: {
          orderId: order.id,
          provider: "nimbuspost",
          providerShipmentId: `np_${spec.orderNumber}`,
          awb: spec.shipment.awb,
          courierName: "BlueDart",
          trackingUrl: `https://track.example.test/${spec.shipment.awb}`,
          pickupAddressId,
          weightGrams: 400,
          lengthCm: 15,
          breadthCm: 10,
          heightCm: 8,
          shippingChargePrice: shippingPrice,
          status: spec.shipment.status,
          shippedAt: placedAt,
          deliveredAt: spec.shipment.status === ShipmentStatus.DELIVERED ? placedAt : null,
          events: {
            create: [
              { status: ShipmentStatus.CREATED, description: "label generated", occurredAt: placedAt },
              { status: ShipmentStatus.PICKED_UP, description: "courier picked up", occurredAt: placedAt },
              { status: ShipmentStatus.IN_TRANSIT, description: "in transit", occurredAt: placedAt },
              ...(spec.shipment.status === ShipmentStatus.DELIVERED
                ? [{ status: ShipmentStatus.DELIVERED, description: "delivered", occurredAt: placedAt }]
                : []),
            ],
          },
        },
      });
      void shipment;
    }

    // promotion redemption (committed — these are historical paid orders)
    if (promo && discountPrice > 0) {
      await prisma.promotionRedemption.create({
        data: {
          promotionId: promo.id,
          orderId: order.id,
          userId,
          rewardType: promo.rewardType,
          code: promo.code,
          amountPrice: discountPrice,
          committed: true,
        },
      });
      await prisma.promotion.update({
        where: { id: promo.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    // review on delivered first item
    if (spec.review && spec.status === OrderStatus.DELIVERED) {
      const firstItem = order.items[0];
      const v = bySku(spec.items[0].sku);
      if (v) {
        await prisma.review.create({
          data: {
            productId: v.productId,
            userId: userId,
            orderItemId: firstItem.id,
            rating: spec.review.rating,
            title: spec.review.title,
            body: spec.review.body,
            status: spec.review.status,
          },
        });
      }
    }

    // inventory adjustment for non-cancelled
    if (spec.status !== OrderStatus.CANCELLED && spec.status !== OrderStatus.CREATED) {
      for (const it of order.items) {
        if (!it.variantId) continue;
        const v = variants.find((x) => x.id === it.variantId)!;
        await prisma.inventoryAdjustment.create({
          data: {
            variantId: it.variantId,
            delta: -it.qty,
            newStock: v.stock,
            reason: "order_placed",
            refOrderId: order.id,
          },
        });
      }
    }
  }
}

// ─── 7) contact + newsletter + settings + webhooks ─────────────────────────

async function seedContactMessages() {
  const msgs = [
    { email: "ravi@example.test", name: "Ravi K", subject: "Bulk order", message: "Hi, I'd like to order 50 bottles for a corporate gift event.", status: "new" },
    { email: "priya@example.test", name: "Priya N", subject: "Damaged item", message: "My Oud Royale arrived with a cracked cap.", status: "in_progress" },
    { email: "lina@example.test", name: "Lina A", subject: "Wholesale inquiry", message: "Do you offer wholesale partnerships for boutiques in UAE?", status: "closed" },
  ];
  for (const m of msgs) {
    const exists = await prisma.contactMessage.findFirst({ where: { email: m.email, message: m.message } });
    if (!exists) await prisma.contactMessage.create({ data: m });
  }
}

async function seedNewsletter() {
  const emails = [
    "newsletter1@example.test",
    "newsletter2@example.test",
    "newsletter3@example.test",
  ];
  for (const email of emails) {
    await prisma.newsletterSubscription.upsert({
      where: { email },
      create: { email },
      update: {},
    });
  }
  // one unsubscribed
  await prisma.newsletterSubscription.upsert({
    where: { email: "unsubbed@example.test" },
    create: { email: "unsubbed@example.test", unsubscribedAt: daysAgo(5) },
    update: { unsubscribedAt: daysAgo(5) },
  });
}

async function seedSettings() {
  const kv: Array<{ key: string; value: unknown }> = [
    { key: "site.title", value: { en: "Jazor Perfumes", ar: "عطور جازور" } },
    { key: "site.tagline", value: { en: "Hand-crafted in India", ar: "صناعة يدوية في الهند" } },
    { key: "site.contactEmail", value: "hello@jazor.test" },
    { key: "site.contactPhone", value: "+912240000000" },
    { key: "shipping.freeAbovePrice", value: 500000 },
    { key: "shipping.flatRatePrice", value: 9900 },
    { key: "tax.gstPercent", value: 18 },
    { key: "social", value: { instagram: "https://instagram.com/jazor", twitter: null } },
  ];
  for (const s of kv) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value as object },
      update: { value: s.value as object },
    });
  }
}

async function seedWebhookEvents() {
  const events = [
    { eventId: "evt_seed_001", eventType: "payment.captured", status: "processed", payload: { ok: true } },
    { eventId: "evt_seed_002", eventType: "payment.failed", status: "processed", payload: { ok: true } },
  ];
  for (const e of events) {
    await prisma.webhookEvent.upsert({
      where: { eventId: e.eventId },
      create: {
        provider: "razorpay",
        eventId: e.eventId,
        eventType: e.eventType,
        payload: e.payload,
        signature: "seed-sig",
        status: e.status,
        processedAt: new Date(),
      },
      update: {},
    });
  }
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  const productStats = await seedProducts();
  const userIds = await seedUsers();
  await seedAddresses(userIds);
  const pickup = await seedPickupAddress();
  const promos = await seedPromotions();
  await seedWishlist(userIds);
  await seedCarts(userIds);
  await seedOrders(userIds, promos, pickup.id);
  await seedContactMessages();
  await seedNewsletter();
  await seedSettings();
  await seedWebhookEvents();

  const summary = {
    products: productStats,
    users: Object.keys(userIds).length,
    promotions: Object.keys(promos).length,
    orders: await prisma.order.count(),
    reviews: await prisma.review.count(),
    cartItems: await prisma.cartItem.count(),
    wishlistItems: await prisma.wishlistItem.count(),
    contactMessages: await prisma.contactMessage.count(),
    newsletterSubs: await prisma.newsletterSubscription.count(),
    settings: await prisma.setting.count(),
    webhookEvents: await prisma.webhookEvent.count(),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
