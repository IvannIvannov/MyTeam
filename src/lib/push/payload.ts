import type { PushNotificationPayload } from "./types";

// Leave room for aes128gcm encryption overhead within a 4096-byte push request.
export const MAX_PUSH_PAYLOAD_BYTES = 3900;
const PREVIEW_SUFFIX = "… Отвори съобщението в страницата.";

export function serializePushPayload(payload: PushNotificationPayload): string {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_PUSH_PAYLOAD_BYTES) return serialized;

  const characters = Array.from(payload.body);
  const preview = (length: number) => JSON.stringify({
    ...payload,
    body: characters.slice(0, length).join("") + PREVIEW_SUFFIX,
  });
  if (Buffer.byteLength(preview(0), "utf8") > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error("Push notification metadata exceeds the payload byte budget");
  }

  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(preview(middle), "utf8") <= MAX_PUSH_PAYLOAD_BYTES) low = middle;
    else high = middle - 1;
  }
  return preview(low);
}
