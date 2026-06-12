import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../.env.test"), override: true });

// Mocked at module-graph level so any import of these names is intercepted
// before the real implementation can issue network calls.
vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../src/services/mailService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/mailService.js")>();
  return {
    ...actual,
    sendMail: vi.fn(async () => undefined),
  };
});

vi.mock("../src/services/invoiceService.js", () => ({
  generateInvoice: vi.fn(async () => Buffer.from("PDF")),
}));

// Cloudinary — stub object-storage uploads/deletes so image-bearing routes
// (refund claims, product images) never issue real network calls in tests.
vi.mock("../src/lib/cloudinary.js", () => ({
  uploadBuffer: vi.fn(async (_buffer: Buffer, folder: string) => ({
    url: `https://res.cloudinary.com/test/${folder}/mock.png`,
    publicId: `${folder}/mock`,
  })),
  destroy: vi.fn(async () => undefined),
}));

// Razorpay REST stubs — verifyPaymentSignature/verifyWebhookSignature remain real
// so signature tests exercise actual crypto. Only outbound network calls are stubbed.
vi.mock("../src/services/razorpayService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/razorpayService.js")>();
  return {
    ...actual,
    createOrder: vi.fn(async () => "rzp_test_order_mock"),
    refundPayment: vi.fn(async () => ({
      providerRefundId: "rfnd_test_mock",
      amountPaise: 0,
      status: "PROCESSED" as const,
    })),
  };
});

let prismaRef: typeof import("../src/lib/prisma.js").prisma | null = null;

async function getPrisma() {
  if (!prismaRef) {
    prismaRef = (await import("../src/lib/prisma.js")).prisma;
  }
  return prismaRef;
}

// Order of truncation respects FK chain; CASCADE handles the rest.
const TRUNCATE_TABLES = [
  "RefundImage",
  "Refund",
  "ShipmentEvent",
  "Shipment",
  "OrderStatusEvent",
  "InventoryAdjustment",
  "OrderItem",
  "Payment",
  "PromotionRedemption",
  "PromotionGiftProduct",
  "Order",
  "Promotion",
  "WebhookEvent",
  "Review",
  "WishlistItem",
  "CartItem",
  "Cart",
  "Address",
  "PickupAddress",
  "ProductImage",
  "ProductVariant",
  "Product",
  "ContactMessage",
  "NewsletterSubscription",
  "Setting",
  "User",
];

beforeAll(async () => {
  await getPrisma();
});

afterEach(async () => {
  const prisma = await getPrisma();
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
  vi.clearAllMocks();
});

afterAll(async () => {
  const prisma = await getPrisma();
  await prisma.$disconnect();
});
