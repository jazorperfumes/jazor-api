import { prisma } from "../lib/prisma.js";

export async function subscribe(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  await prisma.newsletterSubscription.upsert({
    where: { email: normalized },
    create: { email: normalized },
    // Re-subscribe path: clear prior opt-out and refresh consent timestamp.
    update: { unsubscribedAt: null, subscribedAt: new Date() },
  });
}
