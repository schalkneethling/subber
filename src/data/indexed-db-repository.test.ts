import "fake-indexeddb/auto";

import type { DBSchema, IDBPDatabase, OpenDBCallbacks } from "idb";
import { describe, expect, it, vi } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "./migrations.js";
import {
  IndexedDbLifecycleError,
  IndexedDbSubscriptionRepository,
} from "./indexed-db-repository.js";
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
    expect([...database.objectStoreNames]).toEqual([
      "eventRateEnrichments",
      "events",
      "settings",
      "subscriptions",
    ]);
    database.close();
  });

  it("rejects a blocked open and closes a connection that resolves later", async () => {
    let blockedCallback:
      | ((
          currentVersion: number,
          blockedVersion: number | null,
          event: IDBVersionChangeEvent,
        ) => void)
      | undefined;
    let resolveOpen!: (database: IDBPDatabase) => void;
    const close = vi.fn<() => void>();
    const pendingOpen = new Promise<IDBPDatabase>((resolve) => {
      resolveOpen = resolve;
    });
    const openDatabase = <DBTypes extends DBSchema | unknown = unknown>(
      _name: string,
      _version?: number,
      suppliedCallbacks: OpenDBCallbacks<DBTypes> = {},
    ): Promise<IDBPDatabase<DBTypes>> => {
      blockedCallback = suppliedCallbacks.blocked;
      return pendingOpen as Promise<IDBPDatabase<DBTypes>>;
    };
    const lifecycleErrors: IndexedDbLifecycleError[] = [];
    const opening = IndexedDbSubscriptionRepository.open({
      databaseName: `subber-blocked-${databaseSequence++}`,
      openDatabase,
      onLifecycleError(error) {
        lifecycleErrors.push(error);
      },
    });

    blockedCallback?.(1, 2, {} as IDBVersionChangeEvent);

    await expect(opening).rejects.toBe(lifecycleErrors[0]);
    expect(lifecycleErrors[0]).toMatchObject({
      failure: "blocked",
      currentVersion: 1,
      blockedVersion: 2,
    });

    resolveOpen({ close } as unknown as IDBPDatabase);
    await pendingOpen;
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports and releases a connection that blocks a future schema version", async () => {
    const databaseName = `subber-blocking-${databaseSequence++}`;
    const lifecycleErrors: IndexedDbLifecycleError[] = [];
    const repository = await IndexedDbSubscriptionRepository.open({
      databaseName,
      onLifecycleError(error) {
        lifecycleErrors.push(error);
      },
    });

    const upgradedDatabase = await openRawDatabase(databaseName, CURRENT_SCHEMA_VERSION + 1);

    expect(lifecycleErrors).toHaveLength(1);
    expect(lifecycleErrors[0]).toBeInstanceOf(IndexedDbLifecycleError);
    expect(lifecycleErrors[0]).toMatchObject({
      failure: "blocking",
      currentVersion: CURRENT_SCHEMA_VERSION,
      blockedVersion: CURRENT_SCHEMA_VERSION + 1,
    });
    expect(repository.connectionState).toBe("released");
    await expect(repository.getSettings()).rejects.toBe(lifecycleErrors[0]);
    upgradedDatabase.close();
    repository.close();
  });

  it("exposes a released connection and reopens without a lifecycle callback", async () => {
    let blockingCallback:
      | ((
          currentVersion: number,
          blockedVersion: number | null,
          event: IDBVersionChangeEvent,
        ) => void)
      | undefined;
    let openCount = 0;
    const firstClose = vi.fn<() => void>();
    const secondClose = vi.fn<() => void>();
    const secondGet = vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined);
    const openDatabase = <DBTypes extends DBSchema | unknown = unknown>(
      _name: string,
      _version?: number,
      suppliedCallbacks: OpenDBCallbacks<DBTypes> = {},
    ): Promise<IDBPDatabase<DBTypes>> => {
      blockingCallback = suppliedCallbacks.blocking;
      const database =
        openCount++ === 0 ? { close: firstClose } : { close: secondClose, get: secondGet };
      return Promise.resolve(database as unknown as IDBPDatabase<DBTypes>);
    };
    const repository = await IndexedDbSubscriptionRepository.open({ openDatabase });

    blockingCallback?.(
      CURRENT_SCHEMA_VERSION,
      CURRENT_SCHEMA_VERSION + 1,
      {} as IDBVersionChangeEvent,
    );

    expect(repository.connectionState).toBe("released");
    expect(firstClose).toHaveBeenCalledOnce();
    await expect(repository.getSettings()).rejects.toMatchObject({ failure: "blocking" });

    const reopened = await repository.reopen();
    expect(reopened.connectionState).toBe("open");
    await expect(reopened.getSettings()).resolves.toBeNull();
    expect(secondGet).toHaveBeenCalledWith("settings", "settings");

    reopened.close();
    expect(secondClose).toHaveBeenCalledOnce();
  });

  it("reports an abnormal termination with null version metadata", async () => {
    let terminatedCallback: (() => void) | undefined;
    const close = vi.fn<() => void>();
    const openDatabase = <DBTypes extends DBSchema | unknown = unknown>(
      _name: string,
      _version?: number,
      suppliedCallbacks: OpenDBCallbacks<DBTypes> = {},
    ): Promise<IDBPDatabase<DBTypes>> => {
      terminatedCallback = suppliedCallbacks.terminated;
      return Promise.resolve({ close } as unknown as IDBPDatabase<DBTypes>);
    };
    const lifecycleErrors: IndexedDbLifecycleError[] = [];
    const repository = await IndexedDbSubscriptionRepository.open({
      openDatabase,
      onLifecycleError(error) {
        lifecycleErrors.push(error);
      },
    });

    terminatedCallback?.();

    expect(lifecycleErrors).toHaveLength(1);
    expect(lifecycleErrors[0]).toMatchObject({
      failure: "terminated",
      currentVersion: null,
      blockedVersion: null,
    });
    expect(repository.connectionState).toBe("released");
    await expect(repository.getSettings()).rejects.toBe(lifecycleErrors[0]);
    repository.close();
    expect(close).toHaveBeenCalledOnce();
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

async function openRawDatabase(databaseName: string, version?: number): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, version);
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
