import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { productsRouter } from "./routes/products.js";
import { scentFinderRouter } from "./routes/scentFinder.js";
import { settingsRouter } from "./routes/settings.js";
import { contactRouter } from "./routes/contact.js";
import { newsletterRouter } from "./routes/newsletter.js";
import { trackRouter } from "./routes/track.js";
import { cartRouter } from "./routes/cart.js";
import { csrfRouter } from "./routes/csrf.js";
import { promotionsRouter } from "./routes/promotions.js";
import { checkoutRouter } from "./routes/checkout.js";
import { ordersRouter } from "./routes/orders.js";
import { razorpayRouter } from "./routes/razorpay.js";
import { addressesRouter } from "./routes/addresses.js";
import { accountOrdersRouter } from "./routes/accountOrders.js";
import { wishlistRouter } from "./routes/wishlist.js";
import { reviewsRouter } from "./routes/reviews.js";
import { refundClaimsRouter } from "./routes/refundClaims.js";
import { adminRouter } from "./routes/admin.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import * as razorpayController from "./controllers/razorpayController.js";
import * as shippingController from "./controllers/shippingController.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { ensureCsrfCookie, requireCsrf } from "./middleware/csrf.js";

export function createApp() {
  const app = express();

  // Behind a reverse proxy/load balancer in prod the client IP arrives in
  // `X-Forwarded-For`; without this, express-rate-limit keys every request to
  // the proxy IP and the limiters degrade to a global counter.
  if (env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );

  // Razorpay webhook MUST mount before express.json so HMAC verifies against
  // the exact raw bytes. Cookie/CSRF do not apply here — provider-signed.
  app.post(
    "/api/razorpay/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    asyncHandler(razorpayController.webhook),
  );

  // Same rule for shipping provider webhooks: HMAC of raw bytes vs a
  // provider-specific signature header (handled inside the controller).
  app.post(
    "/api/shipping/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    asyncHandler(shippingController.webhook),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  // Issue CSRF cookie for any caller; protects against missing cookie on first request.
  app.use(ensureCsrfCookie);

  // Global rate limit — generous; specific limiters defined on sensitive routes.
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use(globalLimiter);

  // CSRF check for state-changing requests. Safe methods skipped inside middleware.
  app.use(requireCsrf);

  app.use("/api/health", healthRouter);
  app.use("/api/csrf", csrfRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/scent-finder", scentFinderRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/contact", contactRouter);
  app.use("/api/newsletter", newsletterRouter);
  app.use("/api/track", trackRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/promotions", promotionsRouter);
  app.use("/api/checkout", checkoutRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/razorpay", razorpayRouter);
  app.use("/api/account/addresses", addressesRouter);
  app.use("/api/account/orders", accountOrdersRouter);
  app.use("/api/account/wishlist", wishlistRouter);
  app.use("/api/account/reviews", reviewsRouter);
  app.use("/api/account/refund-claims", refundClaimsRouter);
  app.use("/api/admin", adminRouter);

  // Images are hosted on Cloudinary (see lib/cloudinary.ts); no local static
  // mount. URLs stored in the DB are absolute https Cloudinary URLs.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
