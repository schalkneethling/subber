const UUID_V7_RANDOM_BYTES = 10;
const MAX_UUID_TIMESTAMP = 0xffffffffffff;

/** Generates an RFC 9562 UUID v7 using a 48-bit Unix millisecond timestamp. */
export function uuidV7(timestamp = Date.now()): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_UUID_TIMESTAMP) {
    throw new RangeError("UUID v7 timestamp must fit in 48 bits");
  }

  const bytes = new Uint8Array(16);
  const random = crypto.getRandomValues(new Uint8Array(UUID_V7_RANDOM_BYTES));
  let remainingTimestamp = timestamp;

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remainingTimestamp % 256;
    remainingTimestamp = Math.floor(remainingTimestamp / 256);
  }

  bytes.set(random, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hexadecimal = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}
