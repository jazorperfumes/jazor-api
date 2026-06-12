import { describe, expect, it, beforeEach } from "vitest";
import * as checkoutService from "../../src/services/checkoutService.js";
import { addCartItem, makePromotion, makeProduct, makeUser } from "../helpers/factories.js";

describe("checkout.quote math (integer paise only)", () => {
  let userId: string;
  let variantId: string;
  let price: number;

  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    const p = await makeProduct({ price: 50_000, stock: 50 });
    variantId = p.variants[0].id;
    price = 50_000;
  });

  it("CART_EMPTY when nothing in cart", async () => {
    const q = await checkoutService.quote(userId, {});
    expect(q.issues).toContain("CART_EMPTY");
    expect(q.totalPrice).toBe(0);
  });

  it("charges flat shipping when no free-ship promo applies", async () => {
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, {});
    expect(q.subtotalPrice).toBe(price);
    expect(q.shippingPrice).toBe(9900);
    expect(q.totalPrice).toBe(price + 9900);
  });

  it("FREE_SHIPPING promo waives shipping at/above its threshold", async () => {
    await makePromotion({
      rewardType: "FREE_SHIPPING",
      applyMode: "AUTOMATIC",
      minOrderPrice: 199_900,
    });
    const exact = await makeProduct({ price: 199_900, stock: 5 });
    await addCartItem(userId, exact.variants[0].id, 1);
    const q = await checkoutService.quote(userId, {});
    expect(q.subtotalPrice).toBe(199_900);
    expect(q.shippingPrice).toBe(0);
    expect(q.appliedPromotions.some((p) => p.rewardType === "FREE_SHIPPING")).toBe(true);
  });

  it("FREE_SHIPPING promo does not apply below its threshold", async () => {
    await makePromotion({
      rewardType: "FREE_SHIPPING",
      applyMode: "AUTOMATIC",
      minOrderPrice: 199_900,
    });
    const cheaper = await makeProduct({ price: 199_899, stock: 5 });
    await addCartItem(userId, cheaper.variants[0].id, 1);
    const q = await checkoutService.quote(userId, {});
    expect(q.shippingPrice).toBe(9900);
  });

  it("adds gift wrap surcharge of 10000 paise", async () => {
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, { giftWrap: true });
    expect(q.giftWrapPrice).toBe(10000);
    expect(q.totalPrice).toBe(price + 9900 + 10000);
  });

  it("PERCENT discount floors to integer paise", async () => {
    const d = await makePromotion({ rewardType: "PERCENT", value: 33, code: "PCT33" });
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, { discountCodes: [d.code!] });
    expect(q.discountPrice).toBe(Math.floor((price * 33) / 100));
    expect(q.appliedPromotions.some((p) => p.code === "PCT33")).toBe(true);
    expect(Number.isInteger(q.totalPrice)).toBe(true);
  });

  it("FLAT discount never exceeds subtotal", async () => {
    const d = await makePromotion({ rewardType: "FLAT", value: 9_999_999, code: "BIGFLAT" });
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, { discountCodes: [d.code!] });
    expect(q.discountPrice).toBe(price);
    expect(q.totalPrice).toBeGreaterThanOrEqual(0);
  });

  it("rejects a code with MIN_ORDER when subtotal below min", async () => {
    const d = await makePromotion({
      rewardType: "PERCENT",
      value: 10,
      minOrderPrice: 500_000,
      code: "MIN5K",
    });
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, { discountCodes: [d.code!] });
    expect(q.rejectedCodes).toContainEqual({ code: "MIN5K", reason: "MIN_ORDER" });
    expect(q.discountPrice).toBe(0);
  });

  it("rejects an expired code with EXPIRED", async () => {
    const d = await makePromotion({
      code: "OLD",
      expiresAt: new Date(Date.now() - 1000),
    });
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, { discountCodes: [d.code!] });
    expect(q.rejectedCodes).toContainEqual({ code: "OLD", reason: "EXPIRED" });
  });

  it("stacks two percent codes on the original subtotal", async () => {
    const a = await makePromotion({ rewardType: "PERCENT", value: 10, code: "TEN" });
    const b = await makePromotion({ rewardType: "PERCENT", value: 20, code: "TWENTY" });
    await addCartItem(userId, variantId, 1);
    const q = await checkoutService.quote(userId, { discountCodes: [a.code!, b.code!] });
    // 10% + 20% of 50_000, each floored on the original subtotal.
    expect(q.discountPrice).toBe(5_000 + 10_000);
    expect(q.appliedPromotions.length).toBe(2);
  });
});
