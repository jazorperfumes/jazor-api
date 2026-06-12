import { v2 as cloudinary } from "cloudinary";
import { env } from "../env.js";
import { logger } from "./logger.js";

// The SDK self-configures from process.env.CLOUDINARY_URL on first use; touch
// the validated env so a missing credential fails fast at boot, not mid-upload.
void env.CLOUDINARY_URL;

export interface UploadResult {
  url: string;
  publicId: string;
}

/** Upload an in-memory image buffer to a Cloudinary folder. */
export async function uploadBuffer(
  buffer: Buffer,
  folder: string,
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error("Cloudinary upload returned no result"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Best-effort delete by public id — logs and swallows failures. */
export async function destroy(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (err) {
    logger.warn("cloudinary destroy failed", {
      publicId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
