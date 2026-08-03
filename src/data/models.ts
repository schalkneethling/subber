export type BillingChannel = "direct" | "apple" | "google" | "paypal" | "other";

export type BillingCadence = "weekly" | "monthly" | "quarterly" | "biannual" | "annual" | "custom";

declare const partsPerMillionBrand: unique symbol;
export type PartsPerMillion = number & {
  readonly [partsPerMillionBrand]: "PartsPerMillion";
};

export type RateSource = "frankfurter" | "fallback";

export interface EventRateEnrichment {
  eventId: string;
  ratePpm: PartsPerMillion;
  source: RateSource;
  rateFetchedAt: string;
  enrichedAt: string;
  provenance: "captured" | "backfilled";
}

export interface Subscription {
  id: string;
  serviceId: string | null;
  name: string;
  amountMinor: number;
  currency: string;
  cadence: BillingCadence;
  customIntervalDays?: number;
  nextBillingDate?: string;
  billingAnchorDay?: number;
  billingAnchorIsMonthEnd?: boolean;
  billingChannel: BillingChannel;
  cancellationUrlOverride?: string;
  cancellationNote?: string;
  noticePeriodDays?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type SubscriptionEventType = "added" | "removed" | "restored" | "price_changed";

export interface SubscriptionEvent {
  id: string;
  subscriptionId: string;
  type: SubscriptionEventType;
  occurredAt: string;
  amountMinor: number;
  currency: string;
  cadence: BillingCadence;
  monthlyEquivalentMinor: number;
}

export function createPartsPerMillion(value: number): PartsPerMillion {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Parts per million must be a positive safe integer");
  }
  return value as PartsPerMillion;
}

export interface Settings {
  displayCurrency: string;
  hapticsEnabled: boolean;
  biometricLockEnabled: boolean;
  remindersEnabled: boolean;
  schemaVersion: number;
}
