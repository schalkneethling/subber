import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  migrationsBetween,
  runMigrations,
} from "./migrations.js";

describe("migration definitions", () => {
  it("are contiguous and end at the current schema version", () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1),
    );
  });

  it("selects only the forward migrations in a range", () => {
    expect(migrationsBetween(0, CURRENT_SCHEMA_VERSION)).toEqual(MIGRATIONS);
  });

  it("rejects downgrades and gaps", () => {
    expect(() => migrationsBetween(CURRENT_SCHEMA_VERSION, 0)).toThrow(/downgrades/);
    expect(() => migrationsBetween(0, CURRENT_SCHEMA_VERSION + 1)).toThrow(/Missing migration/);
  });

  it("stops at a failed migration without applying later definitions", async () => {
    const failure = new Error("migration failed");
    const apply = vi.fn().mockRejectedValueOnce(failure);

    await expect(runMigrations(0, CURRENT_SCHEMA_VERSION, apply)).rejects.toBe(failure);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
