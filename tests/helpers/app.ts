import request, { type SuperAgentTest, type Test } from "supertest";
import type { Application } from "express";
import { CookieAccessInfo } from "cookiejar";
import { createApp } from "../../src/app.js";

let cachedApp: Application | null = null;

export function getApp(): Application {
  if (!cachedApp) cachedApp = createApp();
  return cachedApp;
}

interface JarAgent {
  jar: {
    getCookie(name: string, access: CookieAccessInfo): { value: string } | undefined;
  };
}

function currentCsrf(agent: SuperAgentTest): string {
  const access = new CookieAccessInfo("127.0.0.1", "/", false, false);
  const c = (agent as unknown as JarAgent).jar.getCookie("jazor_csrf", access);
  return c?.value ?? "";
}

/**
 * supertest agent that:
 * - touches /api/health to receive an initial jazor_csrf cookie
 * - wraps unsafe methods so x-csrf-token is read from the cookie jar at call
 *   time (handles rotateCsrf on login/register without going stale)
 */
export async function makeAgent(): Promise<SuperAgentTest> {
  const app = getApp();
  const agent = request.agent(app) as SuperAgentTest;
  await agent.get("/api/health");

  const unsafe = ["post", "put", "patch", "delete"] as const;
  for (const m of unsafe) {
    const orig = agent[m].bind(agent) as (url: string) => Test;
    (agent as unknown as Record<string, unknown>)[m] = (url: string) =>
      orig(url).set("x-csrf-token", currentCsrf(agent));
  }
  return agent;
}

export { request };
