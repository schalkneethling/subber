import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";

import { CURRENT_SCHEMA_VERSION, migrationsBetween } from "./migrations.js";
import type { EventRateEnrichment, Settings, Subscription, SubscriptionEvent } from "./models.js";
import type {
  RepositoryCommit,
  SubscriptionCollection,
  SubscriptionRepository,
} from "./repository.js";

const SETTINGS_KEY = "settings";
const MAX_ID_LENGTH = 128;
const MAX_SERVICE_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 200;
const MAX_URL_LENGTH = 2_048;
const MAX_NOTE_LENGTH = 10_000;

interface SubberDatabase extends DBSchema {
  subscriptions: {
    key: string;
    value: Subscription;
  };
  events: {
    key: string;
    value: SubscriptionEvent;
    indexes: { "by-subscription": string };
  };
  eventRateEnrichments: {
    key: string;
    value: EventRateEnrichment;
  };
  settings: {
    key: string;
    value: Settings;
  };
}

type UpgradeTransaction = IDBPTransaction<
  SubberDatabase,
  Array<"subscriptions" | "events" | "eventRateEnrichments" | "settings">,
  "versionchange"
>;

export interface IndexedDbRepositoryOptions {
  databaseName?: string;
  /** Receives connection lifecycle failures in addition to open rejection when applicable. */
  onLifecycleError?: (error: IndexedDbLifecycleError) => void;
  /** @internal Allows deterministic testing of browser open lifecycle events. */
  openDatabase?: typeof openDB;
}

export type IndexedDbLifecycleFailure = "blocked" | "blocking" | "terminated";

export class IndexedDbLifecycleError extends Error {
  readonly failure: IndexedDbLifecycleFailure;
  readonly currentVersion: number | null;
  readonly blockedVersion: number | null;

  constructor(
    failure: IndexedDbLifecycleFailure,
    currentVersion: number | null = null,
    blockedVersion: number | null = null,
  ) {
    super(lifecycleErrorMessage(failure));
    this.name = "IndexedDbLifecycleError";
    this.failure = failure;
    this.currentVersion = currentVersion;
    this.blockedVersion = blockedVersion;
  }
}

export class IndexedDbSubscriptionRepository implements SubscriptionRepository {
  readonly #database: IDBPDatabase<SubberDatabase>;

  private constructor(database: IDBPDatabase<SubberDatabase>) {
    this.#database = database;
  }

  static async open(
    options: IndexedDbRepositoryOptions = {},
  ): Promise<IndexedDbSubscriptionRepository> {
    let openedDatabase: IDBPDatabase<SubberDatabase> | undefined;
    let blocked = false;
    let rejectBlocked!: (error: IndexedDbLifecycleError) => void;
    const blockedPromise = new Promise<never>((_resolve, reject) => {
      rejectBlocked = reject;
    });
    const report = (
      failure: IndexedDbLifecycleFailure,
      currentVersion: number | null = null,
      blockedVersion: number | null = null,
    ) => {
      options.onLifecycleError?.(
        new IndexedDbLifecycleError(failure, currentVersion, blockedVersion),
      );
    };
    const openPromise = (options.openDatabase ?? openDB)<SubberDatabase>(
      options.databaseName ?? "subber",
      CURRENT_SCHEMA_VERSION,
      {
        blocked(currentVersion, blockedVersion) {
          if (blocked) return;
          blocked = true;
          const error = new IndexedDbLifecycleError("blocked", currentVersion, blockedVersion);
          rejectBlocked(error);
          options.onLifecycleError?.(error);
        },
        blocking(currentVersion, blockedVersion) {
          openedDatabase?.close();
          report("blocking", currentVersion, blockedVersion);
        },
        terminated() {
          report("terminated");
        },
        upgrade(database, oldVersion, newVersion, transaction) {
          applyMigrations(database, transaction, oldVersion, newVersion ?? CURRENT_SCHEMA_VERSION);
        },
      },
    );
    void openPromise.then(
      (database) => {
        if (blocked) database.close();
      },
      () => undefined,
    );

    const database = await Promise.race([openPromise, blockedPromise]);
    openedDatabase = database;

    return new IndexedDbSubscriptionRepository(database);
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    const subscription = await this.#database.get("subscriptions", id);
    if (!subscription) return null;
    validateSubscription(subscription);
    return subscription;
  }

  async listSubscriptions(collection: SubscriptionCollection = "active"): Promise<Subscription[]> {
    const subscriptions = await this.#database.getAll("subscriptions");
    subscriptions.forEach(validateSubscription);
    const selected = subscriptions.filter((subscription) => {
      if (collection === "all") return true;
      return collection === "archived"
        ? subscription.archivedAt !== null
        : subscription.archivedAt === null;
    });

    return selected.sort(compareSubscriptions(collection));
  }

  async listEvents(subscriptionId?: string): Promise<SubscriptionEvent[]> {
    const events = subscriptionId
      ? await this.#database.getAllFromIndex("events", "by-subscription", subscriptionId)
      : await this.#database.getAll("events");
    events.forEach(validateEvent);

    return events.sort((left, right) => {
      return right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id);
    });
  }

  async getSettings(): Promise<Settings | null> {
    const settings = await this.#database.get("settings", SETTINGS_KEY);
    if (!settings) return null;
    validateSettings(settings);
    return settings;
  }

  async getEventRateEnrichment(eventId: string): Promise<EventRateEnrichment | null> {
    const enrichment = await this.#database.get("eventRateEnrichments", eventId);
    if (!enrichment) return null;
    validateEventRateEnrichment(enrichment);
    return enrichment;
  }

  async listEventRateEnrichments(): Promise<EventRateEnrichment[]> {
    const enrichments = await this.#database.getAll("eventRateEnrichments");
    enrichments.forEach(validateEventRateEnrichment);
    return enrichments.sort(
      (left, right) =>
        right.enrichedAt.localeCompare(left.enrichedAt) ||
        right.eventId.localeCompare(left.eventId),
    );
  }

  async commit(unitOfWork: RepositoryCommit): Promise<void> {
    validateCommit(unitOfWork);

    const transaction = this.#database.transaction(
      ["subscriptions", "events", "eventRateEnrichments", "settings"],
      "readwrite",
    );

    try {
      for (const subscription of unitOfWork.subscriptions ?? []) {
        await transaction.objectStore("subscriptions").put(subscription);
      }
      for (const event of unitOfWork.events ?? []) {
        const subscription = await transaction
          .objectStore("subscriptions")
          .get(event.subscriptionId);
        if (!subscription) {
          throw new DOMException("An event must reference an existing subscription.", "DataError");
        }
        await transaction.objectStore("events").add(event);
      }
      for (const enrichment of unitOfWork.eventRateEnrichments ?? []) {
        const event = await transaction.objectStore("events").get(enrichment.eventId);
        if (!event) {
          throw new DOMException("A rate enrichment must reference an existing event", "DataError");
        }
        await transaction.objectStore("eventRateEnrichments").add(enrichment);
      }
      if (unitOfWork.settings) {
        await transaction.objectStore("settings").put(unitOfWork.settings, SETTINGS_KEY);
      }
      await transaction.done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // A failed request may already have aborted the transaction.
      }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }

  async eraseSubscription(id: string): Promise<void> {
    const transaction = this.#database.transaction(
      ["subscriptions", "events", "eventRateEnrichments"],
      "readwrite",
    );
    const events = await transaction.objectStore("events").index("by-subscription").getAllKeys(id);

    await transaction.objectStore("subscriptions").delete(id);
    await Promise.all(
      events.flatMap((eventId) => [
        transaction.objectStore("eventRateEnrichments").delete(eventId),
        transaction.objectStore("events").delete(eventId),
      ]),
    );
    await transaction.done;
  }

  close(): void {
    this.#database.close();
  }
}

function lifecycleErrorMessage(failure: IndexedDbLifecycleFailure): string {
  switch (failure) {
    case "blocked":
      return "IndexedDB upgrade is blocked by another open connection";
    case "blocking":
      return "This IndexedDB connection is blocking a schema change";
    case "terminated":
      return "The browser terminated the IndexedDB connection unexpectedly";
  }
}

function applyMigrations(
  database: IDBPDatabase<SubberDatabase>,
  transaction: UpgradeTransaction,
  oldVersion: number,
  newVersion: number,
): void {
  for (const migration of migrationsBetween(oldVersion, newVersion)) {
    switch (migration.version) {
      case 1: {
        database.createObjectStore("subscriptions", { keyPath: "id" });
        const events = database.createObjectStore("events", { keyPath: "id" });
        events.createIndex("by-subscription", "subscriptionId");
        database.createObjectStore("eventRateEnrichments", { keyPath: "eventId" });
        database.createObjectStore("settings");
        break;
      }
      default:
        transaction.abort();
        throw new Error(`IndexedDB migration ${migration.version} is not implemented`);
    }
  }
}

function compareSubscriptions(collection: SubscriptionCollection) {
  return (left: Subscription, right: Subscription): number => {
    if (collection === "archived") {
      return right.archivedAt!.localeCompare(left.archivedAt!) || right.id.localeCompare(left.id);
    }

    return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
  };
}

function validateCommit(unitOfWork: RepositoryCommit): void {
  for (const subscription of unitOfWork.subscriptions ?? []) validateSubscription(subscription);
  for (const event of unitOfWork.events ?? []) validateEvent(event);
  for (const enrichment of unitOfWork.eventRateEnrichments ?? []) {
    validateEventRateEnrichment(enrichment);
  }
  if (unitOfWork.settings) validateSettings(unitOfWork.settings);
}

function validateSubscription(subscription: Subscription): void {
  assertNonEmptyString(subscription.id, "subscription.id", MAX_ID_LENGTH);
  assertNonEmptyString(subscription.name, "subscription.name", MAX_NAME_LENGTH);
  if (subscription.serviceId !== null) {
    assertNonEmptyString(subscription.serviceId, "subscription.serviceId", MAX_SERVICE_ID_LENGTH);
  }
  assertInteger(subscription.amountMinor, "subscription.amountMinor", 0);
  assertCurrency(subscription.currency);
  assertOneOf(
    subscription.cadence,
    ["weekly", "monthly", "quarterly", "biannual", "annual", "custom"],
    "subscription.cadence",
  );
  assertOneOf(
    subscription.billingChannel,
    ["direct", "apple", "google", "paypal", "other"],
    "subscription.billingChannel",
  );
  assertIsoInstant(subscription.createdAt, "subscription.createdAt");
  assertIsoInstant(subscription.updatedAt, "subscription.updatedAt");
  if (subscription.archivedAt !== null)
    assertIsoInstant(subscription.archivedAt, "subscription.archivedAt");
  if (subscription.nextBillingDate !== undefined) assertIsoDate(subscription.nextBillingDate);
  if (subscription.cadence === "custom") {
    assertInteger(subscription.customIntervalDays, "subscription.customIntervalDays", 1);
  } else if (subscription.customIntervalDays !== undefined) {
    throw new TypeError("customIntervalDays is only valid for a custom cadence");
  }
  if (subscription.noticePeriodDays !== undefined) {
    assertInteger(subscription.noticePeriodDays, "subscription.noticePeriodDays", 0);
  }
  validateBillingAnchor(subscription);
  assertOptionalString(
    subscription.cancellationUrlOverride,
    "subscription.cancellationUrlOverride",
    MAX_URL_LENGTH,
  );
  assertOptionalString(
    subscription.cancellationNote,
    "subscription.cancellationNote",
    MAX_NOTE_LENGTH,
  );
  assertOptionalString(subscription.notes, "subscription.notes", MAX_NOTE_LENGTH);
}

function validateEvent(event: SubscriptionEvent): void {
  assertNonEmptyString(event.id, "event.id", MAX_ID_LENGTH);
  assertNonEmptyString(event.subscriptionId, "event.subscriptionId", MAX_ID_LENGTH);
  assertInteger(event.amountMinor, "event.amountMinor", 0);
  assertInteger(event.monthlyEquivalentMinor, "event.monthlyEquivalentMinor", 0);
  assertCurrency(event.currency);
  assertOneOf(
    event.cadence,
    ["weekly", "monthly", "quarterly", "biannual", "annual", "custom"],
    "event.cadence",
  );
  assertOneOf(event.type, ["added", "removed", "restored", "price_changed"], "event.type");
  assertIsoInstant(event.occurredAt, "event.occurredAt");
}

function validateEventRateEnrichment(enrichment: EventRateEnrichment): void {
  assertNonEmptyString(enrichment.eventId, "enrichment.eventId", MAX_ID_LENGTH);
  assertInteger(enrichment.ratePpm, "enrichment.ratePpm", 1);
  assertOneOf(enrichment.source, ["frankfurter", "fallback"], "enrichment.source");
  assertIsoInstant(enrichment.rateFetchedAt, "enrichment.rateFetchedAt");
  assertIsoInstant(enrichment.enrichedAt, "enrichment.enrichedAt");
  assertOneOf(enrichment.provenance, ["captured", "backfilled"], "enrichment.provenance");
}

function validateBillingAnchor(subscription: Subscription): void {
  const monthBased = ["monthly", "quarterly", "biannual", "annual"].includes(subscription.cadence);
  const hasAnchorDay = subscription.billingAnchorDay !== undefined;
  const hasMonthEnd = subscription.billingAnchorIsMonthEnd !== undefined;

  if (!monthBased || subscription.nextBillingDate === undefined) {
    if (hasAnchorDay || hasMonthEnd) {
      throw new TypeError("Billing anchors require a month-based cadence and nextBillingDate");
    }
    return;
  }
  if (!hasAnchorDay || !hasMonthEnd) {
    throw new TypeError("Month-based billing dates require both billing anchor fields");
  }

  assertInteger(subscription.billingAnchorDay, "subscription.billingAnchorDay", 1);
  if (subscription.billingAnchorDay > 31) {
    throw new TypeError("subscription.billingAnchorDay must not exceed 31");
  }
  assertBoolean(subscription.billingAnchorIsMonthEnd, "subscription.billingAnchorIsMonthEnd");
}

function validateSettings(settings: Settings): void {
  assertCurrency(settings.displayCurrency);
  assertBoolean(settings.hapticsEnabled, "settings.hapticsEnabled");
  assertBoolean(settings.biometricLockEnabled, "settings.biometricLockEnabled");
  assertBoolean(settings.remindersEnabled, "settings.remindersEnabled");
  assertInteger(settings.schemaVersion, "settings.schemaVersion", 0);
  if (settings.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new RangeError("Settings were created by a newer schema version");
  }
}

function assertInteger(value: unknown, field: string, minimum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${field} must be a safe integer greater than or equal to ${minimum}`);
  }
}

function assertNonEmptyString(
  value: unknown,
  field: string,
  maximumLength: number,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw new TypeError(
      `${field} must be a non-empty string of at most ${maximumLength} characters`,
    );
  }
}

function assertOptionalString(value: unknown, field: string, maximumLength: number): void {
  if (value !== undefined && (typeof value !== "string" || value.length > maximumLength)) {
    throw new TypeError(`${field} must be a string of at most ${maximumLength} characters`);
  }
}

function assertCurrency(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new TypeError("Currency must be a three-letter uppercase ISO 4217 code");
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
}

function assertOneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): asserts value is Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    throw new TypeError(`${field} is not supported`);
  }
}

function assertIsoInstant(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError(`${field} must be an ISO 8601 UTC instant`);
  }

  const canonicalValue = value.includes(".") ? value : value.replace("Z", ".000Z");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonicalValue) {
    throw new TypeError(`${field} must be an ISO 8601 UTC instant`);
  }
}

function assertIsoDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError("nextBillingDate must be an ISO 8601 date");
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new TypeError("nextBillingDate must be a valid calendar date");
  }
}
