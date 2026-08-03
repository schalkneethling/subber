import type { Settings, Subscription, SubscriptionEvent } from "./models.js";

export type SubscriptionCollection = "active" | "archived" | "all";

/**
 * A unit of work. Implementations must persist every supplied record atomically.
 * Events are immutable: inserting an existing event ID must reject the entire commit.
 */
export interface RepositoryCommit {
  subscriptions?: readonly Subscription[];
  events?: readonly SubscriptionEvent[];
  settings?: Settings;
}

export interface SubscriptionRepository {
  getSubscription(id: string): Promise<Subscription | null>;
  /** Active/all records are newest-updated first; archived records are newest-archived first. */
  listSubscriptions(collection?: SubscriptionCollection): Promise<Subscription[]>;
  /** Events are returned in reverse chronological order. */
  listEvents(subscriptionId?: string): Promise<SubscriptionEvent[]>;
  getSettings(): Promise<Settings | null>;
  commit(unitOfWork: RepositoryCommit): Promise<void>;
  eraseSubscription(id: string): Promise<void>;
  close(): void;
}
