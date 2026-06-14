import { Resend } from "resend";
import { env } from "../env.js";
import type { OrderDetailDto } from "../types/orders.js";
import type { RefundClaimDto } from "../types/refundClaims.js";

let client: Resend | null = null;

function getClient(): Resend {
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const { error } = await getClient().emails.send({
    from: env.MAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
  // Resend's SDK returns { error } rather than throwing — rethrow so awaited
  // callers (register) still surface failures and don't strand the user.
  if (error) throw new Error(`resend send failed: ${error.name}: ${error.message}`);
}

// ─── brand email shell ─────────────────────────────────────────────────────
// Table-based, inline-styled HTML so it survives Gmail/Outlook/Apple Mail.
// Dark header band + gold wordmark, light body card, dark footer band.

const BRAND = {
  noir: "#0D1F16", // black-green base
  gold: "#a8864c", // imperial gold (dividers/buttons on light)
  goldLight: "#c9a96e", // lighter gold (text on dark)
  ink: "#1f1f1f",
  body: "#3a3a3a",
  muted: "#8a8a8a",
  page: "#ece8e1", // outer page tone
  cream: "#faf7f2",
  serif: "Georgia, 'Times New Roman', serif",
} as const;

function heading(text: string): string {
  return `<h1 style="margin:0 0 18px;font-family:${BRAND.serif};font-size:24px;font-weight:normal;color:${BRAND.noir};letter-spacing:0.3px">${text}</h1>`;
}

function para(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${BRAND.serif};font-size:16px;line-height:1.65;color:${BRAND.body}">${html}</p>`;
}

function mutedNote(html: string): string {
  return `<p style="margin:18px 0 0;font-family:${BRAND.serif};font-size:13px;line-height:1.6;color:${BRAND.muted}">${html}</p>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0"><tr><td style="background:${BRAND.gold};border-radius:4px">
<a href="${url}" style="display:inline-block;padding:14px 34px;font-family:${BRAND.serif};font-size:15px;color:${BRAND.noir};text-decoration:none;font-weight:bold;letter-spacing:0.6px">${label}</a>
</td></tr></table>`;
}

function goldRule(): string {
  return `<div style="height:1px;background:${BRAND.gold};opacity:0.4;margin:24px 0"></div>`;
}

/**
 * Wrap inner body HTML in the full branded email document.
 * `preheader` is the hidden inbox-preview snippet.
 */
function wrapEmail(opts: { preheader: string; bodyHtml: string }): string {
  const year = new Date().getFullYear();
  const supportMail = escapeHtml(env.SUPPORT_EMAIL);
  const whatsapp = escapeHtml(env.WHATSAPP_NUMBER);
  const legal = escapeHtml(env.BIZ_LEGAL_NAME);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${legal}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 8px 30px rgba(13,31,22,0.12)">
<tr><td style="background:${BRAND.noir};padding:30px 0;text-align:center">
<img src="${env.LOGO_URL_WORDMARK}" alt="${legal}" width="190" style="display:inline-block;width:190px;max-width:60%;height:auto;border:0"/>
</td></tr>
<tr><td style="height:3px;line-height:3px;font-size:0;background:${BRAND.gold}">&nbsp;</td></tr>
<tr><td style="background:#ffffff;padding:38px 42px">
${opts.bodyHtml}
</td></tr>
<tr><td style="background:${BRAND.noir};padding:26px 42px;text-align:center">
<p style="margin:0 0 8px;font-family:${BRAND.serif};font-size:13px;line-height:1.6;color:${BRAND.goldLight}">
<a href="mailto:${supportMail}" style="color:${BRAND.goldLight};text-decoration:none">${supportMail}</a>
&nbsp;&middot;&nbsp; WhatsApp ${whatsapp}
</p>
<p style="margin:0;font-family:${BRAND.serif};font-size:12px;line-height:1.6;color:#7f8c84">
&copy; ${year} ${legal}. All rights reserved.
</p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-family:${BRAND.serif};font-size:11px;color:#a39c90">You received this email because of activity on your ${legal} account.</p>
</td></tr>
</table>
</body></html>`;
}

function formatPaiseInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] as string);
}

function renderOrderItemsHtml(order: OrderDetailDto): string {
  const cell = `padding:11px 0;border-bottom:1px solid #ece8e1;font-family:${BRAND.serif};font-size:15px`;
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="${cell};color:${BRAND.ink}">${escapeHtml(i.name.en)} <span style="color:${BRAND.muted}">· ${i.sizeMl}ml</span></td><td style="${cell};text-align:right;color:${BRAND.muted}">×${i.qty}</td><td style="${cell};text-align:right;color:${BRAND.ink}">${formatPaiseInr(i.lineTotalPrice)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0"><tbody>${rows}</tbody></table>`;
}

function renderOrderTotalsHtml(order: OrderDetailDto): string {
  const row = (label: string, value: string, opts?: { bold?: boolean }) => {
    const weight = opts?.bold ? "bold" : "normal";
    const size = opts?.bold ? "17px" : "14px";
    const color = opts?.bold ? BRAND.noir : BRAND.body;
    const pad = opts?.bold ? "12px 0 0" : "5px 0";
    const border = opts?.bold ? `border-top:2px solid ${BRAND.gold};` : "";
    return `<tr><td style="padding:${pad};${border}font-family:${BRAND.serif};font-size:${size};color:${BRAND.muted};text-align:right">${label}</td><td style="padding:${pad};${border}font-family:${BRAND.serif};font-size:${size};font-weight:${weight};color:${color};text-align:right;width:130px">${value}</td></tr>`;
  };
  const rows: string[] = [row("Subtotal", formatPaiseInr(order.subtotalPrice))];
  if (order.discountPrice > 0) {
    const codes = order.promotions.map((p) => p.code).filter(Boolean);
    const label = codes.length > 0 ? `Discount (${escapeHtml(codes.join(", "))})` : "Discount";
    rows.push(row(label, `−${formatPaiseInr(order.discountPrice)}`));
  }
  if (order.giftWrapPrice > 0) rows.push(row("Gift wrap", formatPaiseInr(order.giftWrapPrice)));
  rows.push(
    row("Shipping", order.shippingPrice === 0 ? "Free" : formatPaiseInr(order.shippingPrice)),
  );
  rows.push(row("Total", formatPaiseInr(order.totalPrice), { bold: true }));
  return `<table role="presentation" align="right" cellpadding="0" cellspacing="0" style="margin-top:6px"><tbody>${rows.join("")}</tbody></table>`;
}

export function passwordResetEmail(name: string | null, link: string) {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const body = `${heading("Reset your password")}
${para(greeting)}
${para("We received a request to reset your Jazor password. Click below to choose a new one — this link is valid for <strong>1 hour</strong>.")}
${button("Reset password", link)}
${mutedNote(`If the button doesn't work, paste this link into your browser:<br/><a href="${link}" style="color:${BRAND.gold};word-break:break-all">${escapeHtml(link)}</a>`)}
${mutedNote("If you didn't request this, you can safely ignore this email — your password won't change.")}`;
  return {
    subject: "Reset your Jazor password",
    text: `${name ? `Hi ${name},` : "Hi,"}\n\nReset your password using this link (valid 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: wrapEmail({ preheader: "Reset your Jazor password — link valid for 1 hour.", bodyHtml: body }),
  };
}

export function verifyOtpEmail(name: string | null, code: string) {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const codeBox = `<div style="margin:8px 0 4px;padding:22px;text-align:center;background:${BRAND.cream};border:1px solid ${BRAND.gold}33;border-radius:6px">
<span style="font-family:${BRAND.serif};font-size:34px;font-weight:bold;letter-spacing:10px;color:${BRAND.noir}">${escapeHtml(code)}</span>
</div>`;
  const body = `${heading("Verify your email")}
${para(greeting)}
${para("Use the code below to verify your email address. It is valid for <strong>10 minutes</strong>.")}
${codeBox}
${mutedNote("Don't share this code with anyone. If you didn't request it, you can ignore this email.")}`;
  return {
    subject: "Your Jazor verification code",
    text: `${name ? `Hi ${name},` : "Hi,"}\n\nYour verification code is ${code}. It is valid for 10 minutes.\nDon't share this code with anyone. If you didn't request it, ignore this email.`,
    html: wrapEmail({ preheader: `Your verification code is ${code} (valid 10 minutes).`, bodyHtml: body }),
  };
}

export function orderConfirmationEmail(order: OrderDetailDto) {
  const greeting = order.shippingAddress.contactName
    ? `Hi ${escapeHtml(order.shippingAddress.contactName)},`
    : "Hi,";
  const body = `${heading("Thank you for your order")}
${para(greeting)}
${para(`Your order has been confirmed. We'll let you know as soon as it ships. Your reference number is <strong>${escapeHtml(order.orderNumber)}</strong>.`)}
${goldRule()}
${renderOrderItemsHtml(order)}
${renderOrderTotalsHtml(order)}
<div style="clear:both"></div>
${goldRule()}
${mutedNote("A detailed tax invoice is attached to this email as a PDF.")}`;
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    text: `${order.shippingAddress.contactName ? `Hi ${order.shippingAddress.contactName},` : "Hi,"}\n\nThank you for your order. Reference: ${order.orderNumber}. Total: ${formatPaiseInr(order.totalPrice)}.\nInvoice attached.`,
    html: wrapEmail({ preheader: `Order ${order.orderNumber} confirmed — ${formatPaiseInr(order.totalPrice)}.`, bodyHtml: body }),
  };
}

export function orderCancellationEmail(
  order: OrderDetailDto,
  refundStatus: "PROCESSED" | "PENDING" | "FAILED" | "NONE",
) {
  const greeting = order.shippingAddress.contactName
    ? `Hi ${escapeHtml(order.shippingAddress.contactName)},`
    : "Hi,";
  const refundLine =
    refundStatus === "PROCESSED"
      ? para(`A refund of <strong>${formatPaiseInr(order.totalPrice)}</strong> has been processed back to your original payment method.`)
      : refundStatus === "PENDING"
        ? para(`A refund of <strong>${formatPaiseInr(order.totalPrice)}</strong> has been initiated. Funds typically reach your account within 5–7 working days.`)
        : refundStatus === "FAILED"
          ? para("We were unable to initiate the refund automatically. Our team will reach out shortly.")
          : para("No payment was captured for this order, so no refund is required.");
  const body = `${heading("Your order was cancelled")}
${para(greeting)}
${para(`Your order <strong>${escapeHtml(order.orderNumber)}</strong> has been cancelled.`)}
${refundLine}
${mutedNote(`If this was a mistake, please contact <a href="mailto:${escapeHtml(env.SUPPORT_EMAIL)}" style="color:${BRAND.gold}">${escapeHtml(env.SUPPORT_EMAIL)}</a>.`)}`;
  return {
    subject: `Order cancelled — ${order.orderNumber}`,
    text: `${order.shippingAddress.contactName ? `Hi ${order.shippingAddress.contactName},` : "Hi,"}\n\nYour order ${order.orderNumber} has been cancelled.\nRefund status: ${refundStatus}.`,
    html: wrapEmail({ preheader: `Order ${order.orderNumber} cancelled.`, bodyHtml: body }),
  };
}

// ─── admin alerts (plain — internal, no branding) ──────────────────────────

export function adminOrderAlertEmail(order: OrderDetailDto) {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.name.en)} · ${i.sizeMl}ml</td><td style="text-align:right">×${i.qty}</td><td style="text-align:right">${formatPaiseInr(i.lineTotalPrice)}</td></tr>`,
    )
    .join("");
  return {
    subject: `New order — ${order.orderNumber} · ${formatPaiseInr(order.totalPrice)}`,
    text: `New order ${order.orderNumber} (${formatPaiseInr(order.totalPrice)}) for ${order.email}.`,
    html: `<p><strong>New order</strong> · ${escapeHtml(order.orderNumber)}</p>
<p>Customer: ${escapeHtml(order.shippingAddress.contactName)} (${escapeHtml(order.email)}, ${escapeHtml(order.phone)})</p>
<table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${rows}</tbody></table>
<p><strong>Total:</strong> ${formatPaiseInr(order.totalPrice)}</p>`,
  };
}

/**
 * Captured payment landed on an order that was no longer CREATED (e.g. the
 * stock-reaper cancelled it first). Money is in, stock was already restored —
 * a human must re-stock + ship or issue a refund.
 */
export function adminPaidAfterCancelEmail(order: OrderDetailDto) {
  return {
    subject: `⚠ Payment on cancelled order — ${order.orderNumber} · ${formatPaiseInr(order.totalPrice)}`,
    text: `Payment was captured for order ${order.orderNumber} (${formatPaiseInr(order.totalPrice)}, ${order.email}) but the order was already in status ${order.status} (likely auto-cancelled before payment landed). Stock was restored. Reconcile manually: re-stock + ship, or refund the customer.`,
    html: `<p><strong>⚠ Payment captured on a non-active order</strong></p>
<p>Order: ${escapeHtml(order.orderNumber)}<br/>Current status: <strong>${escapeHtml(order.status)}</strong><br/>Customer: ${escapeHtml(order.email)}, ${escapeHtml(order.phone)}<br/>Amount captured: ${formatPaiseInr(order.totalPrice)}</p>
<p>The order was no longer CREATED when payment landed (most likely auto-cancelled by the stock-reaper after the payment window). Stock has already been restored, so the order was NOT auto-marked PAID.</p>
<p><strong>Action needed:</strong> verify stock and either re-stock + ship this order, or refund the customer.</p>`,
  };
}

// ─── refund claim templates ───────────────────────────────────────────────

function claimItemLabel(claim: RefundClaimDto): string {
  const name = claim.itemName?.en || "your item";
  const size = claim.itemSizeMl ? `${claim.itemSizeMl}ml` : "";
  return `${escapeHtml(name)}${size ? ` · ${size}` : ""}`;
}

export function refundClaimSubmittedEmail(claim: RefundClaimDto, orderNumber: string) {
  const body = `${heading("Refund claim received")}
${para("Hi,")}
${para(`We have received your refund claim for order <strong>${escapeHtml(orderNumber)}</strong>.`)}
${para(`Item: ${claimItemLabel(claim)}<br/>Refund amount if approved: <strong>${formatPaiseInr(claim.amountPrice)}</strong>`)}
${para("Our team will review the photos you submitted and respond within 2 business days.")}
${mutedNote("If you have additional details to share, simply reply to this email.")}`;
  return {
    subject: `Refund claim received — ${orderNumber}`,
    text: `We have received your refund claim for order ${orderNumber}. Item: ${claim.itemName?.en ?? ""}. Amount: ${formatPaiseInr(claim.amountPrice)}. Our team will review your photos and respond within 2 business days.`,
    html: wrapEmail({ preheader: `Refund claim for ${orderNumber} received.`, bodyHtml: body }),
  };
}

export function adminRefundClaimAlertEmail(
  claim: RefundClaimDto,
  orderNumber: string,
  customerEmail: string,
) {
  return {
    subject: `Refund claim filed — ${orderNumber} · ${formatPaiseInr(claim.amountPrice)}`,
    text: `New refund claim on order ${orderNumber} from ${customerEmail}. Item: ${claim.itemName?.en ?? ""}. Reason: ${claim.reasonCode}. Amount: ${formatPaiseInr(claim.amountPrice)}.`,
    html: `<p><strong>New refund claim</strong> on order ${escapeHtml(orderNumber)}</p>
<p>From: ${escapeHtml(customerEmail)}<br/>Item: ${claimItemLabel(claim)}<br/>Reason: ${escapeHtml(claim.reasonCode ?? "")}<br/>Amount: ${formatPaiseInr(claim.amountPrice)}<br/>Images: ${claim.images.length}</p>
<p>Description: ${escapeHtml(claim.userDescription ?? "")}</p>
<p style="color:#666">Review in admin: /admin/refund-claims/${claim.id}</p>`,
  };
}

export function refundClaimApprovedEmail(
  claim: RefundClaimDto,
  orderNumber: string,
  providerStatus: "PROCESSED" | "PENDING" | "FAILED",
) {
  const settledLine =
    providerStatus === "PROCESSED"
      ? para(`A refund of <strong>${formatPaiseInr(claim.amountPrice)}</strong> has been processed back to your original payment method.`)
      : providerStatus === "PENDING"
        ? para(`A refund of <strong>${formatPaiseInr(claim.amountPrice)}</strong> has been initiated. Funds typically reach your account within 5–7 working days.`)
        : para("Your claim has been approved, but we hit an issue initiating the refund automatically. Our team will reach out shortly.");
  const body = `${heading("Your refund was approved")}
${para("Hi,")}
${para(`Good news — your refund claim for order <strong>${escapeHtml(orderNumber)}</strong> has been approved.`)}
${para(`Item: ${claimItemLabel(claim)}`)}
${settledLine}
${claim.reviewNote ? mutedNote(`Note from our team: ${escapeHtml(claim.reviewNote)}`) : ""}`;
  return {
    subject: `Refund approved — ${orderNumber}`,
    text: `Your refund claim for order ${orderNumber} has been approved. Amount: ${formatPaiseInr(claim.amountPrice)}.`,
    html: wrapEmail({ preheader: `Refund approved for order ${orderNumber}.`, bodyHtml: body }),
  };
}

export function refundClaimRejectedEmail(claim: RefundClaimDto, orderNumber: string) {
  const body = `${heading("Refund claim update")}
${para("Hi,")}
${para(`We reviewed your refund claim for order <strong>${escapeHtml(orderNumber)}</strong> and were unable to approve it at this time.`)}
${para(`Item: ${claimItemLabel(claim)}`)}
${claim.reviewNote ? para(`<strong>Reason:</strong> ${escapeHtml(claim.reviewNote)}`) : ""}
${mutedNote(`If you believe this was decided in error, please reach out to <a href="mailto:${escapeHtml(env.SUPPORT_EMAIL)}" style="color:${BRAND.gold}">${escapeHtml(env.SUPPORT_EMAIL)}</a>.`)}`;
  return {
    subject: `Refund claim update — ${orderNumber}`,
    text: `Your refund claim for order ${orderNumber} could not be approved. Reason: ${claim.reviewNote ?? ""}`,
    html: wrapEmail({ preheader: `Update on your refund claim for ${orderNumber}.`, bodyHtml: body }),
  };
}
