import { env } from "./env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { reapStaleCreatedOrders } from "./services/ordersService.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

// Stock reaper: cancels CREATED orders older than ORDER_CREATED_TTL_MIN and
// restores stock. Runs every STOCK_REAPER_INTERVAL_MIN minutes.
const reaperHandle = setInterval(
  () => {
    reapStaleCreatedOrders()
      .then((n) => {
        if (n > 0) logger.info("reaper cancelled stale orders", { count: n });
      })
      .catch((err) => logger.error("reaper run failed", err as Error));
  },
  env.STOCK_REAPER_INTERVAL_MIN * 60_000,
);
reaperHandle.unref();

async function shutdown(signal: string) {
  logger.info(`\n${signal} received, shutting down`);
  clearInterval(reaperHandle);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
