export type BillingChannel = "direct" | "apple" | "google" | "paypal" | "other";

export type BillingCadence = "weekly" | "monthly" | "quarterly" | "biannual" | "annual" | "custom";

export interface Subscription {
  id: string;
  serviceId: string | null;
  name: string;
  amountMinor: number;
  currency: string;
  cadence: BillingCadence;
  customIntervalDays?: number;
  nextBillingDate?: string;
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
  usdRatePpm: number | null;
}

export interface Settings {
  displayCurrency: string;
  hapticsEnabled: boolean;
  biometricLockEnabled: boolean;
  remindersEnabled: boolean;
  schemaVersion: number;
}
