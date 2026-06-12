import multer, { MulterError } from "multer";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { customAlphabet } from "nanoid";
import { HttpError } from "./error.js";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export const idGen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export function extFromMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return "";
}

const baseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new HttpError(400, "FILE_INVALID", "Only png/jpeg/webp allowed"));
      return;
    }
    cb(null, true);
  },
});

/**
 * Wrap multer single() to translate MulterError → HttpError so the global
 * error middleware can render the ApiResponse envelope cleanly.
 */
export function productImageUpload(field: string): RequestHandler {
  const handler = baseUpload.single(field);
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof HttpError) return next(err);
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, "FILE_TOO_LARGE", "File exceeds 5MB limit"));
        }
        return next(new HttpError(400, "FILE_INVALID", err.message));
      }
      next(err);
    });
  };
}

// ─── refund-claim multi-file upload (memory) ──────────────────────────────

const REFUND_MAX_FILES = 5;

const refundClaimMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: REFUND_MAX_FILES },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new HttpError(400, "FILE_INVALID", "Only png/jpeg/webp allowed"));
      return;
    }
    cb(null, true);
  },
});

/**
 * Refund-claim submit: accepts up to 5 image files via `images` field +
 * JSON-encoded body fields. Files land in memory; the service is responsible
 * for persisting to disk under uploads/refund-claims/<refundId>/ after the
 * Refund row is created.
 */
export function refundClaimImagesUpload(field: string): RequestHandler {
  const handler = refundClaimMulter.array(field, REFUND_MAX_FILES);
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof HttpError) return next(err);
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, "FILE_TOO_LARGE", "File exceeds 5MB limit"));
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return next(new HttpError(400, "FILE_INVALID", "Max 5 images allowed"));
        }
        return next(new HttpError(400, "FILE_INVALID", err.message));
      }
      next(err);
    });
  };
}

// ─── product import CSV upload (memory) ────────────────────────────────────

const CSV_MAX_BYTES = 2 * 1024 * 1024;
const CSV_MIME = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/octet-stream",
]);

const productCsvMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const okMime = CSV_MIME.has(file.mimetype);
    const okExt = file.originalname.toLowerCase().endsWith(".csv");
    if (!okMime && !okExt) {
      cb(new HttpError(400, "FILE_INVALID", "Only .csv files allowed"));
      return;
    }
    cb(null, true);
  },
});

/**
 * Admin product import: single CSV file in memory under `field`. The service
 * parses the buffer; nothing is written to disk.
 */
export function productCsvUpload(field: string): RequestHandler {
  const handler = productCsvMulter.single(field);
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof HttpError) return next(err);
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, "FILE_TOO_LARGE", "CSV exceeds 2MB limit"));
        }
        return next(new HttpError(400, "FILE_INVALID", err.message));
      }
      next(err);
    });
  };
}
