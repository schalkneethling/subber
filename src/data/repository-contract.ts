import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "./migrations.js";
import type { Settings, Subscription, SubscriptionEvent } from "./models.js";
import type { SubscriptionRepository } from "./repository.js";

export function runRepositoryContract(
  name: string,
  createRepository: () => Promise<SubscriptionRepository>,
): void {
  describe(`${name} repository contract`, () => {
    let repository: SubscriptionRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    afterEach(() => {
      repository.close();
    });

    it("creates, reads, updates, and permanently erases subscriptions", async () => {
      const original = subscription({
        id: "01911111-1111-7111-8111-111111111111",
        name: "Original",
      });
      await repository.commit({ subscriptions: [original] });

      expect(await repository.getSubscription(original.id)).toEqual(original);

      const updated = { ...original, name: "Updated", updatedAt: "2026-02-02T00:00:00.000Z" };
      await repository.commit({ subscriptions: [updated] });
      expect(await repository.getSubscription(original.id)).toEqual(updated);

      await repository.eraseSubscription(original.id);
      expect(await repository.getSubscription(original.id)).toBeNull();
    });

    it("returns active subscriptions by most recent update", async () => {
      const older = subscription({
        id: "01911111-1111-7111-8111-111111111111",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const newer = subscription({
        id: "01922222-2222-7222-8222-222222222222",
        updatedAt: "2026-02-01T00:00:00.000Z",
      });
      const archived = subscription({
        id: "01933333-3333-7333-8333-333333333333",
        archivedAt: "2026-03-01T00:00:00.000Z",
      });
      await repository.commit({ subscriptions: [older, archived, newer] });

      expect((await repository.listSubscriptions()).map(({ id }) => id)).toEqual([
        newer.id,
        older.id,
      ]);
    });

    it("returns archived subscriptions by most recent archive", async () => {
      const older = subscription({
        id: "01911111-1111-7111-8111-111111111111",
        archivedAt: "2026-01-01T00:00:00.000Z",
      });
      const newer = subscription({
        id: "01922222-2222-7222-8222-222222222222",
        archivedAt: "2026-02-01T00:00:00.000Z",
      });
      await repository.commit({ subscriptions: [newer, older] });

      expect((await repository.listSubscriptions("archived")).map(({ id }) => id)).toEqual([
        newer.id,
        older.id,
      ]);
    });

    it("keeps events immutable, ordered, and filterable by subscription", async () => {
      const firstSubscription = subscription({ id: "01911111-1111-7111-8111-111111111111" });
      const secondSubscription = subscription({ id: "01922222-2222-7222-8222-222222222222" });
      const older = event({
        id: "01931111-1111-7111-8111-111111111111",
        subscriptionId: firstSubscription.id,
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      const newer = event({
        id: "01932222-2222-7222-8222-222222222222",
        subscriptionId: firstSubscription.id,
        occurredAt: "2026-02-01T00:00:00.000Z",
      });
      const unrelated = event({
        id: "01933333-3333-7333-8333-333333333333",
        subscriptionId: secondSubscription.id,
      });
      await repository.commit({
        subscriptions: [firstSubscription, secondSubscription],
        events: [older, newer, unrelated],
      });

      expect((await repository.listEvents(firstSubscription.id)).map(({ id }) => id)).toEqual([
        newer.id,
        older.id,
      ]);
      await expect(
        repository.commit({ events: [{ ...older, amountMinor: older.amountMinor + 1 }] }),
      ).rejects.toBeDefined();
      expect(await repository.listEvents(firstSubscription.id)).toContainEqual(older);
    });

    it("stores settings as a singleton", async () => {
      expect(await repository.getSettings()).toBeNull();
      const original = settings();
      await repository.commit({ settings: original });
      expect(await repository.getSettings()).toEqual(original);

      const updated = { ...original, displayCurrency: "EUR" };
      await repository.commit({ settings: updated });
      expect(await repository.getSettings()).toEqual(updated);
    });

    it("rolls back all related writes when one write fails", async () => {
      const original = subscription({ id: "01911111-1111-7111-8111-111111111111" });
      const originalEvent = event({
        id: "01922222-2222-7222-8222-222222222222",
        subscriptionId: original.id,
      });
      const originalSettings = settings();
      await repository.commit({
        subscriptions: [original],
        events: [originalEvent],
        settings: originalSettings,
      });

      const changed = {
        ...original,
        amountMinor: 2_000,
        updatedAt: "2026-02-01T00:00:00.000Z",
      };
      const newEvent = event({
        id: "01933333-3333-7333-8333-333333333333",
        subscriptionId: original.id,
        type: "price_changed",
        occurredAt: "2026-02-01T00:00:00.000Z",
        amountMinor: changed.amountMinor,
        monthlyEquivalentMinor: changed.amountMinor,
      });
      const changedSettings = { ...originalSettings, displayCurrency: "EUR" };
      await expect(
        repository.commit({
          subscriptions: [changed],
          events: [newEvent, originalEvent],
          settings: changedSettings,
        }),
      ).rejects.toBeDefined();

      expect(await repository.getSubscription(original.id)).toEqual(original);
      expect(await repository.listEvents(original.id)).toEqual([originalEvent]);
      expect(await repository.getSettings()).toEqual(originalSettings);
    });

    it("rejects orphan events and fractional financial values", async () => {
      await expect(
        repository.commit({
          events: [event({ subscriptionId: "01999999-9999-7999-8999-999999999999" })],
        }),
      ).rejects.toBeDefined();

      await expect(
        repository.commit({ subscriptions: [subscription({ amountMinor: 10.5 })] }),
      ).rejects.toThrow(/safe integer/);
      await expect(
        repository.commit({
          subscriptions: [subscription()],
          events: [event({ usdRatePpm: 1.5 })],
        }),
      ).rejects.toThrow(/safe integer/);
    });

    it("permanently erases related event history in the same operation", async () => {
      const record = subscription();
      await repository.commit({
        subscriptions: [record],
        events: [event({ subscriptionId: record.id })],
      });

      await repository.eraseSubscription(record.id);
      expect(await repository.listEvents(record.id)).toEqual([]);
    });
  });
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "01900000-0000-7000-8000-000000000000",
    serviceId: null,
    name: "Example",
    amountMinor: 1_000,
    currency: "USD",
    cadence: "monthly",
    billingChannel: "direct",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function event(overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    subscriptionId: "01900000-0000-7000-8000-000000000000",
    type: "added",
    occurredAt: "2026-01-01T00:00:00.000Z",
    amountMinor: 1_000,
    currency: "USD",
    cadence: "monthly",
    monthlyEquivalentMinor: 1_000,
    usdRatePpm: null,
    ...overrides,
  };
}

function settings(): Settings {
  return {
    displayCurrency: "ZAR",
    hapticsEnabled: true,
    biometricLockEnabled: false,
    remindersEnabled: true,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
