import { prisma } from "../lib/prisma.js";
import type { ContactFormRequest } from "../types/contact.js";

export async function create(input: ContactFormRequest): Promise<void> {
  await prisma.contactMessage.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase().trim(),
      subject: input.subject ?? null,
      message: input.message,
    },
  });
}
