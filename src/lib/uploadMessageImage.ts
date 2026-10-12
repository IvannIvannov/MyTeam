import sharp from "sharp";
import { randomUUID } from "crypto";
import { cloudinary } from "@/lib/cloudinary";

export async function uploadMessageImage(file: File): Promise<{ imageUrl: string; imagePublicId: string }> {
  const image = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: `messages/${randomUUID()}`, resource_type: "image" },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Image upload failed"));
        resolve({ imageUrl: result.secure_url, imagePublicId: result.public_id });
      },
    );
    stream.end(image);
  });
}
