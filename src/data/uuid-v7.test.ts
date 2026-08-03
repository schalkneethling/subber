import { afterEach, describe, expect, it, vi } from "vitest";

import { uuidV7 } from "./uuid-v7.js";

describe("uuidV7", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes the timestamp, version, and RFC variant", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).fill(0);
      return array;
    });

    const id = uuidV7(1_700_000_000_000);

    expect(id).toBe("018bcfe5-6800-7000-8000-000000000000");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts lexicographically by millisecond timestamp", () => {
    expect(uuidV7(1_000) < uuidV7(1_001)).toBe(true);
  });

  it("rejects timestamps outside the UUID v7 range", () => {
    expect(() => uuidV7(-1)).toThrow(RangeError);
    expect(() => uuidV7(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});
