import { createECDH, randomBytes } from "crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { MAX_PUSH_PAYLOAD_BYTES, serializePushPayload } from "./payload";

describe("push payload previews", () => {
  it("preserves a short message exactly", () => {
    const payload = { title: "Message", body: "Здравей 👋", url: "/member/ABC" };
    expect(serializePushPayload(payload)).toBe(JSON.stringify(payload));
  });

  it.each(["А", "😀", '"\\\n', "word "])("fits long %j text into the UTF-8 byte budget", text => {
    const payload = {
      title: "Съобщение до треньори", body: text.repeat(6000),
      url: "/admin/members?clubId=club&coachGroupId=group",
      data: { type: "admin_message" },
    };
    const original = structuredClone(payload);
    const serialized = serializePushPayload(payload);
    const preview = JSON.parse(serialized);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(preview.body).toContain("Отвори съобщението в страницата.");
    expect(preview.body).not.toContain("\uFFFD");
    expect(preview.url).toBe(payload.url);
    expect(preview.data).toEqual(payload.data);
    expect(payload).toEqual(original);

    // Exercise real encryption locally, without sending a network request.
    const key = createECDH("prime256v1");
    key.generateKeys();
    const encrypted = webpush.encrypt(
      key.getPublicKey().toString("base64url"), randomBytes(16).toString("base64url"),
      serialized, "aes128gcm",
    );
    expect(encrypted.cipherText.length).toBeLessThanOrEqual(4096);
  });

  it("keeps messages at the exact byte boundary unchanged", () => {
    const payload = { title: "Message", body: "" };
    const overhead = Buffer.byteLength(JSON.stringify(payload), "utf8");
    payload.body = "a".repeat(MAX_PUSH_PAYLOAD_BYTES - overhead);
    expect(serializePushPayload(payload)).toBe(JSON.stringify(payload));
    payload.body += "a";
    expect(JSON.parse(serializePushPayload(payload)).body).not.toBe(payload.body);
  });

  it("rejects oversized metadata rather than dropping the destination link", () => {
    expect(() => serializePushPayload({ title: "Message", body: "Hello", url: "x".repeat(5000) })).toThrow("metadata");
  });
});
