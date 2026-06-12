import { config as loadEnv } from "dotenv";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");

export default async function globalSetup() {
  loadEnv({ path: path.join(apiRoot, ".env.test"), override: true });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing — load .env.test");
  }

  execSync("npx prisma migrate deploy", {
    cwd: apiRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
}
