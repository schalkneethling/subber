import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "./migrations.js";
import { IndexedDbSubscriptionRepository } from "./indexed-db-repository.js";
import { runRepositoryContract } from "./repository-contract.js";

let databaseSequence = 0;

runRepositoryContract("IndexedDB", () =>
  IndexedDbSubscriptionRepository.open({
    databaseName: `subber-contract-${databaseSequence++}`,
  }),
);

describe("IndexedDB migrations", () => {
  it("migrates a new database forward to the current schema", async () => {
    const databaseName = `subber-migration-${databaseSequence++}`;
    const repository = await IndexedDbSubscriptionRepository.open({ databaseName });
    repository.close();

    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });

    expect(database.version).toBe(CURRENT_SCHEMA_VERSION);
    expect([...database.objectStoreNames]).toEqual(["events", "settings", "subscriptions"]);
    database.close();
  });
});

describe("IndexedDB trust boundary", () => {
  it("rejects a persisted subscription with a hostile optional-field shape", async () => {
    const databaseName = `subber-hostile-record-${databaseSequence++}`;
    const repository = await IndexedDbSubscriptionRepository.open({ databaseName });
    const database = await openRawDatabase(databaseName);
    try {
      const transaction = database.transaction("subscriptions", "readwrite");

      transaction.objectStore("subscriptions").put({
        id: "01900000-0000-7000-8000-000000000000",
        serviceId: null,
        name: "Untrusted record",
        amountMinor: 1_000,
        currency: "USD",
        cadence: "monthly",
        billingChannel: "direct",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        notes: { html: "<img src=x onerror=alert(1)>" },
      });
      await transactionComplete(transaction);

      await expect(
        repository.getSubscription("01900000-0000-7000-8000-000000000000"),
      ).rejects.toThrow(/subscription\.notes/);
    } finally {
      database.close();
      repository.close();
    }
  });
});

async function openRawDatabase(databaseName: string): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName);
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}
