import { describe, expect, it } from "vitest";
import { makeAgent } from "../helpers/app.js";
import { makeProduct, makeUser } from "../helpers/factories.js";
import { prisma } from "../../src/lib/prisma.js";

async function loginAs(email: string, password: string) {
  const agent = await makeAgent();
  await agent.post("/api/auth/login").send({ email, password });
  return agent;
}

describe("/api/cart (auth-only)", () => {
  it("401 when unauthenticated", async () => {
    const agent = await makeAgent();
    const res = await agent.get("/api/cart");
    expect(res.status).toBe(401);
  });

  it("GET returns empty cart for new user", async () => {
    const u = await makeUser();
    const agent = await loginAs(u.email, u.password);
    const res = await agent.get("/api/cart");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.subtotalPrice).toBe(0);
    expect(res.body.data.itemCount).toBe(0);
  });

  it("POST /items adds item with lineTotal = price * qty", async () => {
    const u = await makeUser();
    const product = await makeProduct({ price: 75_000, stock: 10 });
    const agent = await loginAs(u.email, u.password);

    const res = await agent
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 2 });
    expect(res.status).toBe(201);
    expect(res.body.data.items[0].qty).toBe(2);
    expect(res.body.data.items[0].lineTotal).toBe(150_000);
    expect(res.body.data.subtotalPrice).toBe(150_000);
  });

  it("POST /items twice on same variant increments qty (upsert)", async () => {
    const u = await makeUser();
    const product = await makeProduct({ price: 50_000, stock: 10 });
    const agent = await loginAs(u.email, u.password);

    await agent.post("/api/cart/items").send({ variantId: product.variants[0].id, qty: 2 });
    const res = await agent
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].qty).toBe(3);
  });

  it("rejects qty > MAX_CART_QTY (10)", async () => {
    const u = await makeUser();
    const product = await makeProduct({ price: 10_000, stock: 100 });
    const agent = await loginAs(u.email, u.password);
    const res = await agent
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 11 });
    expect(res.status).toBe(400);
  });

  it("PATCH /items/:id updates qty", async () => {
    const u = await makeUser();
    const product = await makeProduct({ price: 10_000, stock: 50 });
    const agent = await loginAs(u.email, u.password);
    const add = await agent
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 1 });
    const itemId = add.body.data.items[0].id;
    const res = await agent.patch(`/api/cart/items/${itemId}`).send({ qty: 4 });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].qty).toBe(4);
  });

  it("DELETE /items/:id removes one item", async () => {
    const u = await makeUser();
    const product = await makeProduct({ price: 10_000, stock: 50 });
    const agent = await loginAs(u.email, u.password);
    const add = await agent
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 1 });
    const itemId = add.body.data.items[0].id;
    const res = await agent.delete(`/api/cart/items/${itemId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(0);
  });

  it("DELETE /api/cart clears cart", async () => {
    const u = await makeUser();
    const p1 = await makeProduct({ price: 10_000, stock: 50 });
    const p2 = await makeProduct({ price: 20_000, stock: 50, sku: "ALT-1" });
    const agent = await loginAs(u.email, u.password);
    await agent.post("/api/cart/items").send({ variantId: p1.variants[0].id, qty: 1 });
    await agent.post("/api/cart/items").send({ variantId: p2.variants[0].id, qty: 1 });
    const res = await agent.delete("/api/cart");
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(0);
  });

  it("PATCH on another user's cart item returns 404 (no enumeration)", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const product = await makeProduct({ price: 10_000, stock: 50 });

    const agent1 = await loginAs(u1.email, u1.password);
    const add = await agent1
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 1 });
    const otherUserItemId = add.body.data.items[0].id;

    const agent2 = await loginAs(u2.email, u2.password);
    const res = await agent2.patch(`/api/cart/items/${otherUserItemId}`).send({ qty: 5 });
    expect(res.status).toBe(404);

    const item = await prisma.cartItem.findUnique({ where: { id: otherUserItemId } });
    expect(item?.qty).toBe(1); // unchanged
  });

  it("404 when adding inactive variant", async () => {
    const u = await makeUser();
    const product = await makeProduct({ price: 10_000, stock: 10 });
    await prisma.productVariant.update({
      where: { id: product.variants[0].id },
      data: { isActive: false },
    });
    const agent = await loginAs(u.email, u.password);
    const res = await agent
      .post("/api/cart/items")
      .send({ variantId: product.variants[0].id, qty: 1 });
    expect(res.status).toBe(404);
  });
});
