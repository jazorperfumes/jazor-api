import { env } from "../env.js";
import * as cartService from "./cartService.js";
import * as promotionsService from "./promotionsService.js";
import type { EngineResult } from "./promotionsService.js";
import type { CartDto } from "../types/cart.js";
import type { QuoteItemDto, QuoteRequest, QuoteResponse } from "../types/checkout.js";

function emptyQuote(): QuoteResponse {
  return {
    items: [],
    subtotalPrice: 0,
    discountPrice: 0,
    shippingPrice: 0,
    giftWrapPrice: 0,
    totalPrice: 0,
    appliedPromotions: [],
    bxgyOffers: [],
    rejectedCodes: [],
    issues: ["CART_EMPTY"],
  };
}

export interface DetailedQuote {
  quote: QuoteResponse;
  engine: EngineResult | null;
  cart: CartDto;
}

/**
 * Full quote including the resolved engine result (gift lines + redemptions),
 * needed by order placement. `quote()` exposes only the wire-safe subset.
 */
export async function quoteDetailed(
  userId: string,
  input: QuoteRequest,
): Promise<DetailedQuote> {
  const cart = await cartService.getCart(userId);
  if (cart.items.length === 0) {
    return { quote: emptyQuote(), engine: null, cart };
  }

  const items: QuoteItemDto[] = cart.items.map((i) => ({
    variantId: i.variantId,
    name: i.name,
    slug: i.slug,
    image: i.image,
    sizeMl: i.sizeMl,
    unitPrice: i.unitPrice,
    qty: i.qty,
    lineTotal: i.lineTotal,
    inStock: i.inStock,
    availableStock: i.availableStock,
  }));

  const cartSubtotal = items.reduce((s, i) => s + i.lineTotal, 0);

  const engine = await promotionsService.applyPromotions({
    userId,
    items: cart.items.map((i) => ({
      variantId: i.variantId,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
    subtotalPrice: cartSubtotal,
    discountCodes: input.discountCodes ?? [],
    giftSelections: input.giftSelections ?? [],
  });

  // Gift lines are shown as free (₹0) line items — not folded into subtotal then
  // discounted back out. Their retail value lives on the BxGy promotion record
  // (engine.giftValue / PromotionRedemption.amountPrice), not on the money math.
  for (const g of engine.giftLines) {
    items.push({
      variantId: g.variantId,
      name: g.name,
      slug: g.slug,
      image: g.image,
      sizeMl: g.sizeMl,
      unitPrice: 0,
      qty: 1,
      lineTotal: 0,
      inStock: g.inStock,
      availableStock: g.availableStock,
      isGift: true,
    });
  }

  const subtotalPrice = cartSubtotal;
  const discountPrice = engine.monetaryDiscount;
  const giftWrapPrice = input.giftWrap ? env.GIFT_WRAP_PAISE : 0;
  const totalPrice = subtotalPrice - discountPrice + engine.shippingPrice + giftWrapPrice;

  const issues: QuoteResponse["issues"] = [];
  if (items.some((i) => !i.inStock)) issues.push("OUT_OF_STOCK");
  if (engine.bxgyGiftRequired) issues.push("BXGY_GIFT_REQUIRED");

  const quote: QuoteResponse = {
    items,
    subtotalPrice,
    discountPrice,
    shippingPrice: engine.shippingPrice,
    giftWrapPrice,
    totalPrice,
    appliedPromotions: engine.appliedPromotions,
    bxgyOffers: engine.bxgyOffers,
    rejectedCodes: engine.rejectedCodes,
    issues,
  };

  return { quote, engine, cart };
}

export async function quote(userId: string, input: QuoteRequest): Promise<QuoteResponse> {
  const { quote } = await quoteDetailed(userId, input);
  return quote;
}
