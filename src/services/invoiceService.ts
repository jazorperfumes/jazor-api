import PDFDocument from "pdfkit";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import type { OrderDetailDto } from "../types/orders.js";

const GOLD = "#a8864c";
const NOIR = "#0d1f16";
const MUTED = "#6b6b6b";
const INK = "#1f1f1f";

// Fetch the brand logo once and cache the buffer (and a failed-fetch null) for
// the process lifetime — invoices are generated frequently, the logo is static.
let logoBufferPromise: Promise<Buffer | null> | null = null;
function getLogoBuffer(): Promise<Buffer | null> {
  if (!logoBufferPromise) {
    logoBufferPromise = (async () => {
      try {
        const res = await fetch(env.LOGO_URL_WORDMARK);
        if (!res.ok) {
          logger.warn("invoice logo fetch failed", { status: res.status });
          return null;
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        logger.warn("invoice logo fetch error", {
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })();
  }
  return logoBufferPromise;
}

/**
 * A4 invoice PDF, language=en (i18n decision: invoice stays English for GST
 * compliance + courier paperwork). Returns a Buffer for email attachment.
 */
export async function generateInvoice(order: OrderDetailDto): Promise<Buffer> {
  const logo = await getLogoBuffer();
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header: logo (or name fallback) left, TAX INVOICE label right ──
    if (logo) {
      try {
        doc.image(logo, 50, 48, { height: 42 });
      } catch {
        doc.fontSize(22).fillColor(NOIR).text(env.BIZ_LEGAL_NAME, 50, 52);
      }
    } else {
      doc.fontSize(22).fillColor(NOIR).text(env.BIZ_LEGAL_NAME, 50, 52);
    }
    doc
      .fontSize(11)
      .fillColor(GOLD)
      .text("TAX INVOICE", 345, 54, { width: 200, align: "right", characterSpacing: 3 });
    if (env.BIZ_GSTIN) {
      doc
        .fontSize(9)
        .fillColor(MUTED)
        .text(`GSTIN: ${env.BIZ_GSTIN}`, 345, 74, { width: 200, align: "right" });
    }

    // Gold rule under header
    doc.moveTo(50, 104).lineTo(545, 104).lineWidth(1.5).strokeColor(GOLD).stroke();

    // ── Meta + Bill-to ──
    const topY = 122;
    doc
      .fontSize(10)
      .fillColor(INK)
      .text(`Order #${order.orderNumber}`, 50, topY)
      .fillColor(MUTED)
      .text(`Placed: ${new Date(order.placedAt).toLocaleString("en-IN")}`, 50, topY + 15)
      .text(`Status: ${order.status}`, 50, topY + 30);

    const billY = topY + 64;
    doc
      .fontSize(9)
      .fillColor(GOLD)
      .text("BILL TO", 50, billY, { characterSpacing: 1.5 });
    doc.fontSize(10).fillColor(INK);
    doc.text(order.shippingAddress.contactName, 50, billY + 16);
    doc.fillColor(MUTED).text(order.shippingAddress.line1, 50, billY + 30);
    if (order.shippingAddress.line2) {
      doc.text(order.shippingAddress.line2, 50, billY + 44);
    }
    const cityLineY = billY + (order.shippingAddress.line2 ? 58 : 44);
    doc
      .text(
        `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.pincode}`,
        50,
        cityLineY,
      )
      .text(order.shippingAddress.country, 50, cityLineY + 14)
      .text(`Phone: ${order.shippingAddress.phone}`, 50, cityLineY + 28)
      .text(`Email: ${order.email}`, 50, cityLineY + 42);

    // ── Items table ──
    const tableY = cityLineY + 78;
    doc.fontSize(9).fillColor(GOLD).font("Helvetica-Bold");
    doc.text("ITEM", 50, tableY, { characterSpacing: 1 });
    doc.text("QTY", 320, tableY, { width: 50, align: "right" });
    doc.text("UNIT", 380, tableY, { width: 70, align: "right" });
    doc.text("TOTAL", 460, tableY, { width: 85, align: "right" });
    doc.font("Helvetica").fillColor(INK).fontSize(10);
    doc.moveTo(50, tableY + 15).lineTo(545, tableY + 15).lineWidth(0.5).strokeColor("#d9d3c7").stroke();

    let rowY = tableY + 24;
    for (const item of order.items) {
      const label = item.isGift ? `${item.name.en} (gift)` : item.name.en;
      doc.fillColor(INK).text(label, 50, rowY, { width: 250, continued: false });
      doc.fillColor(MUTED).fontSize(8).text(`${item.sizeMl}ml`, 50, rowY + 12, { width: 250 });
      doc.fillColor(INK).fontSize(10);
      doc.text(String(item.qty), 320, rowY, { width: 50, align: "right" });
      doc.text(item.isGift ? "Free" : formatRupees(item.unitPrice), 380, rowY, { width: 70, align: "right" });
      doc.text(item.isGift ? "Free" : formatRupees(item.lineTotalPrice), 460, rowY, { width: 85, align: "right" });
      rowY += 30;
    }

    doc.moveTo(50, rowY).lineTo(545, rowY).lineWidth(0.5).strokeColor("#d9d3c7").stroke();
    rowY += 14;

    // ── Totals ──
    const totalsX = 360;
    const valX = 460;
    const totalRow = (label: string, value: string, bold = false) => {
      if (bold) {
        doc.moveTo(totalsX, rowY - 4).lineTo(545, rowY - 4).lineWidth(1.5).strokeColor(GOLD).stroke();
        doc.font("Helvetica-Bold").fontSize(12).fillColor(NOIR);
      } else {
        doc.font("Helvetica").fontSize(10).fillColor(MUTED);
      }
      doc.text(label, totalsX, rowY, { width: 90, align: "right" });
      doc.fillColor(bold ? NOIR : INK).text(value, valX, rowY, { width: 85, align: "right" });
      doc.font("Helvetica");
      rowY += bold ? 20 : 17;
    };
    totalRow("Subtotal", formatRupees(order.subtotalPrice));
    if (order.discountPrice > 0) {
      // Only monetary promos contribute to discountPrice — exclude BxGy gift
      // codes (the gift shows as a free line item above).
      const codes = order.promotions
        .filter((p) => p.rewardType === "PERCENT" || p.rewardType === "FLAT")
        .map((p) => p.code)
        .filter(Boolean);
      const label = codes.length > 0 ? `Discount (${codes.join(", ")})` : "Discount";
      totalRow(label, `−${formatRupees(order.discountPrice)}`);
    }
    if (order.giftWrapPrice > 0) totalRow("Gift wrap", formatRupees(order.giftWrapPrice));
    totalRow("Shipping", order.shippingPrice === 0 ? "Free" : formatRupees(order.shippingPrice));
    totalRow("Total", formatRupees(order.totalPrice), true);

    // ── Footer ──
    doc.moveTo(50, 768).lineTo(545, 768).lineWidth(0.5).strokeColor(GOLD).stroke();
    doc.fontSize(9).fillColor(NOIR).font("Helvetica-Bold");
    doc.text("Thank you for shopping with Jazor", 50, 776, { width: 495, align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    if (env.BIZ_ADDRESS) doc.text(env.BIZ_ADDRESS, 50, 790, { width: 495, align: "center" });
    doc.text(
      `Support: ${env.SUPPORT_EMAIL} · WhatsApp: ${env.WHATSAPP_NUMBER}`,
      50,
      802,
      { width: 495, align: "center" },
    );

    doc.end();
  });
}

function formatRupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
