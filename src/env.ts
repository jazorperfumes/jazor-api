import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  APP_URL: z.string().url().default("http://localhost:5173"),

  RESEND_API_KEY: z.string().min(1),
  MAIL_FROM: z.string().min(1), // e.g. "Jazor <no-reply@jazor.in>" — sandbox: "onboarding@resend.dev"

  // Cloudinary — object storage/CDN for product, refund-claim, and brand images.
  // Single URL credential: cloudinary://<api_key>:<api_secret>@<cloud_name>.
  // The SDK auto-reads process.env.CLOUDINARY_URL; we validate presence here.
  CLOUDINARY_URL: z.string().min(1),
  // Public Cloudinary URLs for brand logos used in email/invoice (UI keeps its
  // own bundled copies). Defaults point at the hosted gold logos.
  LOGO_URL_FULL: z
    .string()
    .url()
    .default("https://res.cloudinary.com/dg71nsz7j/image/upload/v1781196476/logo-full-gold_ud5oct.png"),
  LOGO_URL_WORDMARK: z
    .string()
    .url()
    .default("https://res.cloudinary.com/dg71nsz7j/image/upload/v1781196457/logo-wordmark-gold_n8oank.png"),

  // Commerce constants (paise where applicable).
  FLAT_SHIPPING_PAISE: z.coerce.number().int().nonnegative().default(9900),
  // Always-on free shipping when post-discount subtotal ≥ this. 0 disables it
  // (then shipping is free only via a FREE_SHIPPING promotion).
  FREE_SHIPPING_THRESHOLD_PAISE: z.coerce.number().int().nonnegative().default(259900),
  GIFT_WRAP_PAISE: z.coerce.number().int().nonnegative().default(4900),

  // Public contact channels surfaced via /api/settings/public.
  WHATSAPP_NUMBER: z.string().default("+917992020111"),
  SUPPORT_EMAIL: z.string().email().default("jazorfirms@gmail.com"),

  // Razorpay — REST + widget. Test credentials available from dashboard.razorpay.com.
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // Order workflow.
  ADMIN_ALERT_EMAIL: z.string().email(),
  ORDER_CREATED_TTL_MIN: z.coerce.number().int().positive().default(30),
  STOCK_REAPER_INTERVAL_MIN: z.coerce.number().int().positive().default(5),
  REFUND_CLAIM_WINDOW_DAYS: z.coerce.number().int().positive().default(14),

  // Invoice footer.
  BIZ_LEGAL_NAME: z.string().default("Jazor Perfumes"),
  BIZ_ADDRESS: z.string().default(""),
  BIZ_GSTIN: z.string().default(""),

  // Shipping — pluggable provider. Defaults to "manual" so admin uses manual
  // ship form until creds set; flip to "nimbuspost" (or future provider) once
  // configured. Provider-specific credential blocks live below.
  SHIPPING_PROVIDER: z.enum(["manual", "nimbuspost"]).default("manual"),

  // NimbusPost (required when SHIPPING_PROVIDER=nimbuspost).
  NIMBUSPOST_BASE_URL: z.string().url().default("https://api.nimbuspost.com/v1"),
  NIMBUSPOST_EMAIL: z.string().optional(),
  NIMBUSPOST_PASSWORD: z.string().optional(),
  NIMBUSPOST_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Fail fast at boot if a live provider is selected without its credentials —
// catches misconfigured deploys before admin tries to ship.
if (parsed.data.SHIPPING_PROVIDER === "nimbuspost") {
  const missing: string[] = [];
  if (!parsed.data.NIMBUSPOST_EMAIL) missing.push("NIMBUSPOST_EMAIL");
  if (!parsed.data.NIMBUSPOST_PASSWORD) missing.push("NIMBUSPOST_PASSWORD");
  if (!parsed.data.NIMBUSPOST_WEBHOOK_SECRET) missing.push("NIMBUSPOST_WEBHOOK_SECRET");
  if (missing.length > 0) {
    console.error(`SHIPPING_PROVIDER=nimbuspost but missing: ${missing.join(", ")}`);
    process.exit(1);
  }
}

export const env = parsed.data;
