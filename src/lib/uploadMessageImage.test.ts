import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { uploadMessageImage } from "./uploadMessageImage";
const upload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cloudinary", () => ({ cloudinary: { uploader: { upload_stream: upload } } }));
describe("message image validation", () => {
  it("resizes a valid image and stores it once in the messages folder", async () => {
    let stored: Buffer | undefined;
    upload.mockImplementation((options, done) => ({ end: (buffer: Buffer) => {
      stored = buffer;
      done(null, { secure_url: "https://example.com/photo.webp", public_id: options.public_id });
    } }));
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "red" } }).png().toBuffer();
    const result = await uploadMessageImage(new File([new Uint8Array(png)], "photo.png", { type: "image/png" }));
    expect(result.imagePublicId.startsWith("messages/")).toBe(true);
    const metadata = await sharp(stored!).metadata();
    expect(metadata).toMatchObject({ width: 1600, height: 800, format: "webp" });
    upload.mockClear();
  });
  it("rejects a file disguised as an image before contacting storage", async () => {
    await expect(uploadMessageImage(new File(["not an image"], "photo.png", { type: "image/png" }))).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
});
