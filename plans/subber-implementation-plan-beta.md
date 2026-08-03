# Subscription Tracker — Implementation Plan and Light PRD

**Status:** Ready for implementation
**Owner:** Schalk Neethling
**Target platforms:** Installable web application, Apple App Store, Google Play

---

## 1. Product framing

### 1.1 What this is

A personal subscription tracker. The user enters their subscriptions by hand. The application shows what those subscriptions cost in total, in United States Dollars and in a currency of the user's choosing, and gives the user a direct route to cancelling anything they no longer want.

There is no bank linking, no email scanning, and no account. All data belongs to the device and is exportable by the user at any time.

### 1.2 The emotional truth of the product

The category is mechanical because most products in it are database viewers with a currency symbol attached. This product is built on a different premise.

The user is not opening the application to admire a list. They are opening it because money is leaving their account for things they have partly forgotten about. That is a mildly uncomfortable feeling, and the product design has to respect it. The two failure modes are opposite and equally bad: too mechanical and the product is joyless, too playful and it reads as though the application is amused by the user's spending.

The resolution is that delight comes from **revelation and relief**, never from decoration. Every element of personality in this product must either make a number more vivid or make the user feel better about acting on it. Anything that does neither is noise and should be cut.

The single most important consequence of this framing: **removing a subscription is not a destructive action, it is the point of the product.** Every other tracker treats deletion as loss. This one treats it as the reward.

### 1.3 Success criteria

The product succeeds when a user can find it, install it from either the web or the store they expect, and record their subscriptions quickly and without confusion. Beyond that first session, success is measured by continued use at a realistic cadence, which is a few times per month rather than daily, and by store ratings.

### 1.4 Failure criteria

The product fails if it is hard to discover, absent from the stores where users look for it, or if it loses user data. It also fails through poor experience, which includes inaccessible interaction, sluggish performance, and visual design that reads as unfinished. Appearance is a functional requirement here, not a finishing touch.

### 1.5 Explicit non-goals for version one

The application does not cancel subscriptions on the user's behalf. It links out. This distinction must be reflected in the store listing and in the interface copy, because overstating it creates both review risk and user disappointment.

There is no account system, no cloud synchronisation, no shared or household view, no bank integration, and no price change detection.

---

## 2. Architecture decisions

### 2.1 Platform

The web application is the source of truth. It is built with native HTML, CSS, and JavaScript, ships as an installable Progressive Web Application, and is wrapped with Capacitor to produce binaries for the Apple App Store and Google Play.

React Native was considered and rejected. It would remove the WebView ceiling on iOS and give real platform accessibility, but it costs the web as a first-class target and replaces the web platform with a constrained subset that resembles CSS without being it. The rule applied here is that React Native suits a product where native is primary and web is secondary or absent. This product is the opposite case.

### 2.2 Native capabilities

Three native capabilities are in scope, chosen because each is a real feature rather than a checkbox, and because together they establish enough platform integration to satisfy Apple's minimum functionality requirement under Guideline 4.2.

Local notifications provide cancellation deadline reminders. Biometric lock protects a view of the user's spending. Haptics provide physical feedback at the moments of state change described in section 5.

A share sheet is explicitly out of scope. Export is a file download on web and a file write on native.

### 2.3 Libraries

The project uses as few third-party libraries as the work allows. The only substantial user interface dependency is the combobox that powers service selection.

The CSS customizable select was evaluated and rejected, and the reason is filtering rather than browser support. The customizable select provides first-letter typeahead, not a filter field, and the service catalogue is large enough that filtering is a requirement rather than a nicety. That reason is durable and does not expire.

The support argument is deliberately not the rationale, because it is about to become dated. Customizable select shipped in Safari 27 beta, announced on 8 June 2026, alongside the existing Chromium support from Chrome 135. It is therefore a multi-vendor feature in the process of becoming widely available, and the practical floor for this application will lag Safari 27 for a long time regardless. Use it for the small fixed selects where it fits. Do not use it for service selection.

**Use Zag.js for the combobox**, wrapped in a custom element. Zag.js is framework-agnostic, usable from vanilla JavaScript, ships no styles, and its combobox machine already handles filtering, grouping, keyboard interaction, and the ARIA wiring. If the vanilla adapter proves awkward in practice, Ark UI is the fallback, at the cost of adopting one of its supported frameworks.

**The custom element must render into light DOM. Do not attach a shadow root.** The combobox depends on ARIA identifier references between the input, the listbox, and the options, and those references do not resolve across a shadow boundary. Rendering into light DOM avoids that entire class of failure and keeps the global stylesheet applicable.

Radix Primitives is not suitable. It has a Select but no first-class Combobox, and its Select offers first-letter typeahead rather than a filter field.

**Accept the tradeoff explicitly:** moving off the native select means giving up a guaranteed-accessible iOS picker in exchange for a custom combobox. Budget real device testing with VoiceOver as a planned task, not as a hope.

### 2.4 Storage

Storage sits behind a repository interface with two implementations.

On native, use SQLite through the Capacitor community plugin. On web, use IndexedDB through `idb`. Both implementations satisfy the same contract and the same migration definitions. The Vitest suite runs the same contract test file against both.

This split exists because the SQLite plugin's web path runs through WebAssembly backed by IndexedDB, which is heavier and historically more fragile than using IndexedDB directly. The web application is a first-class install target, not a demonstration, so it deserves the simpler and better-supported path.

On web, request durable storage after the user's first meaningful interaction, which is the first successful subscription save rather than on page load. Treat the capability and its result as explicit state: `granted`, `denied`, `unsupported`, or `error`, with the attempt timestamp. Check that `navigator.storage?.persist` is callable before invoking it; a resolved `false` is `denied`, absence is `unsupported`, and rejection is `error`. None of those outcomes may fail or roll back the subscription save. A denied or failed request may be retried after a later user gesture, but not on every application start.

Whenever persistence is not `granted`, concise export guidance and its export action remain visible from the overview or settings rather than appearing only once. The guidance may be dismissible for the current session, but it returns later while the non-granted state remains relevant.

`navigator.storage.persist()` is a request, not a durability guarantee. Even a `true` result does not protect data from explicit site-data clearing, device loss, browser defects, or every platform-specific eviction policy. The interface must not describe granted persistence as “backed up” or “safe forever”; export remains the user-controlled durability mechanism.

**Treat the iOS Safari browser tab as the highest data loss risk in the product.** Script-writable storage on iOS is subject to a seven day cap measured in Safari use without interaction with the site, and the practical effect of `navigator.storage.persist()` under that policy is not something Apple documents unambiguously. A user who opens the application a few times a month, which is the stated usage pattern, sits inside that window rather than outside it. Section 1.4 names data loss as a failure criterion, and this is the most probable route to it.

Web applications installed to the home screen are exempt from the cap. That makes the iOS installation path a data safety feature rather than a distribution convenience, and it must not wait for phase six. From phase one, an iOS Safari visitor who saves a first subscription is shown a short explanation of how to install to the home screen and why it matters, alongside an export action. Neither is a blocking modal. Both are dismissible and both reappear on a later session if still relevant.

Export and import are mandatory in the first user-facing slice, on both platforms. This is the durability guarantee that neither storage engine provides on its own.

### 2.5 Currency conversion

Use Frankfurter as the primary source. It requires no key, is sourced from European Central Bank reference rates, permits commercial reuse, and covers both USD and ZAR within its roughly thirty currency set.

Use the jsDelivr-hosted currency API maintained by fawazahmed0 as a fallback and for currencies outside the ECB reference set.

Fetch at most once per day. Source adapters preserve wire rates as decimal strings, quantise them to validated integer parts per million as specified in section 3.1, and only then create the `RateTable`; binary floating-point rates never enter the domain model or cache. Cache the entire validated integer table with its source and fetch timestamp. Convert entirely on the client. When rates are stale or the device is offline, display the last known rates with a visible date label. Never block the interface on a rate fetch.

### 2.6 Logos and service catalogue

Logos come from svgl.app, curated and bundled rather than fetched at runtime. Bundling avoids the rate limit, works offline, and removes a runtime dependency. Fill gaps from Simple Icons where a service is missing.

Logos are decorative. They carry an empty `alt` attribute and the service name text supplies the accessible name. They are used inside the application only, never in store listings, screenshots, or marketing material.

The service catalogue itself, including cancellation URLs, ships as a versioned JSON file that the application fetches and caches, with the bundled copy as offline fallback. Cancellation URLs change often, and a data push is far preferable to an App Store review cycle for a broken link.

Catalogue cancellation URLs and user overrides allow absolute `https:` URLs only. Relative and protocol-relative URLs, embedded credentials, control characters, and every other scheme, including `javascript:`, `data:`, `file:`, `intent:`, `mailto:`, and `tel:`, are rejected. Non-web cancellation paths belong in `cancellationNote`.

The supported platform deep-link scheme set is explicitly empty in version one. Apple and Google subscription management use product-owned, compile-time HTTPS URLs with exact hosts and paths rather than remotely configured or user-supplied deep-link schemes. If a later release adds a native scheme, it must enumerate the exact scheme and destination shape here, restrict it to a product-owned constant with provenance distinct from catalogue and override data, add real-device tests, and ship through application review; remote data can never opt a scheme into the allowlist.

Validation is repeated at every trust boundary. The bundled catalogue is validated as part of its build check. A downloaded catalogue is schema- and URL-validated before it replaces the cache; one invalid cancellation URL rejects that catalogue version and preserves the last valid or bundled copy. Cached catalogue data is validated again when read. User overrides and imported subscriptions are validated before repository persistence. Immediately before navigation, the destination is reparsed, its provenance is identified, and it is checked against the applicable rule: untrusted catalogue and override values require HTTPS, while a product-owned platform constant must match its exact compiled HTTPS host and path. Failure is closed, leaves the application in place, and shows a neutral explanation. No earlier validation result authorises a later navigation. Web navigation also prevents opener access, and native navigation uses the system browser rather than an embedded view.

### 2.7 Fonts

Self-host a subsetted variable WOFF2. Inter is the default recommendation: it is licensed under the SIL Open Font License, safe to bundle in a distributed application, and supports tabular figures, which are required wherever currency amounts appear.

Preload the primary face, use `font-display: swap`, and define a fallback `@font-face` with `size-adjust`, `ascent-override`, `descent-override`, and `line-gap-override` matched to the web font so that the swap produces no layout shift. Numbers moving on load is highly visible in a product made of numbers.

Target under one hundred kilobytes for the total font payload.

---

## 3. Data model

Money is stored as integer minor units. Never use floating point for currency amounts anywhere in this codebase.

```ts
type BillingChannel = "direct" | "apple" | "google" | "paypal" | "other";

type BillingCadence = "weekly" | "monthly" | "quarterly" | "biannual" | "annual" | "custom";

declare const partsPerMillionBrand: unique symbol;
type PartsPerMillion = number & {
  readonly [partsPerMillionBrand]: "PartsPerMillion";
}; // positive safe integer, created only by the validating constructor
type RateSource = "frankfurter" | "fallback";

interface EventRateEnrichment {
  eventId: string; // unique key; references an immutable event
  ratePpm: PartsPerMillion; // USD major units per event-currency major unit
  source: RateSource;
  rateFetchedAt: string;
  enrichedAt: string;
  provenance: "captured" | "backfilled";
}

interface Subscription {
  id: string; // UUID v7, time-sortable
  serviceId: string | null; // catalogue reference, null when custom
  name: string; // display name, always populated
  amountMinor: number; // integer minor units
  currency: string; // ISO 4217
  cadence: BillingCadence;
  customIntervalDays?: number; // required when cadence is "custom"
  nextBillingDate?: string; // ISO 8601 date
  billingAnchorDay?: number; // original local day, retained through short months
  billingAnchorIsMonthEnd?: boolean; // whether each target stays on its final day
  billingChannel: BillingChannel;
  cancellationUrlOverride?: string; // takes precedence over catalogue value
  cancellationNote?: string; // free text, for non-URL cancellation paths
  noticePeriodDays?: number; // drives the deadline reminder
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null; // set on removal, never hard-deleted
}
```

Removal sets `archivedAt` rather than deleting the row. The row is required for the freed-up tally and the annual recap, and soft deletion makes undo trivial. A separate, explicit "erase permanently" action exists in settings for users who want it.

```ts
type SubscriptionEventType = "added" | "removed" | "restored" | "price_changed";

interface SubscriptionEvent {
  id: string;
  subscriptionId: string;
  type: SubscriptionEventType;
  occurredAt: string;
  amountMinor: number; // amount at the time of the event
  currency: string;
  cadence: BillingCadence;
  monthlyEquivalentMinor: number; // in the event's own currency, always present
}
```

The event log exists from the first slice even though the recap ships last. Retrofitting history is not possible.

The snapshot is recorded in the event's own currency, not in United States Dollars. This matters because the event log ships in phase one and currency conversion does not arrive until phase two, and because the first usable version of the application supports a single currency that is not necessarily USD. Recording the native amount means the event log is complete and correct from the first record.

Rate enrichment is a separate append-only store keyed uniquely by event identifier. An event written before rates are available simply has no `EventRateEnrichment` record; the `SubscriptionEvent` itself is never patched. When a valid rate is available as the event is created, the repository transaction inserts the event and its complete enrichment record atomically with `provenance: "captured"`.

Phase two backfill inserts a missing enrichment record with `provenance: "backfilled"`, using the current valid table and recording both when that table was fetched and when enrichment occurred. It is insert-if-absent under the unique event key: if another writer wins the race, the existing record is retained. Enrichment records are immutable and never replaced, “refreshed”, or partially patched, including after import or migration. A later movement in exchange rates must not rewrite what the user was told or which rate was available at enrichment time. Export and import preserve events and enrichment records as separate append-only collections after schema and referential-integrity validation.

The freed-up tally is computed from these event-time snapshots, never from current rates. The figure is a record of what the user achieved, and it does not move when the Rand does.

Identifiers use UUID v7 for time ordering. Note that `crypto.randomUUID()` produces v4, so a small v7 generator is needed. It is roughly thirty lines and has no dependencies.

```ts
interface CatalogService {
  id: string;
  name: string;
  aliases: string[]; // drives combobox matching
  category: string;
  logoLight: string; // bundled asset path
  logoDark?: string;
  accentColor?: string; // OKLCH string
  cancellationUrl?: string;
  cancellationNote?: string;
  domain?: string;
}

interface Catalog {
  version: number;
  updatedAt: string;
  services: CatalogService[];
}
```

```ts
interface RateTable {
  base: string; // ISO 4217
  fetchedAt: string;
  source: RateSource;
  ratesPpm: Record<string, PartsPerMillion>;
}

interface Settings {
  displayCurrency: string; // only total in phase 1; second alongside USD from phase 2
  hapticsEnabled: boolean;
  biometricLockEnabled: boolean;
  remindersEnabled: boolean;
  schemaVersion: number;
}
```

### 3.1 Derived values and the rounding policy

The monthly equivalent is the normalisation point for every total and every sort.

**Normalise through days, using one rational constant.** Every cadence is first expressed as an interval in days, then converted to a monthly equivalent by multiplying by the average month length. Define that ratio once without a binary floating-point intermediate:

```ts
const DAYS_PER_MONTH_NUMERATOR = 243_495n;
const DAYS_PER_MONTH_DENOMINATOR = 8_000n; // 30.436875 exactly
```

Weekly is a seven day interval. Monthly is one month directly. Quarterly is three months. Biannual is six months. Annual is twelve months. Custom uses its interval in days.

This replaces an earlier formulation in which weekly multiplied by fifty-two and divided by twelve, giving approximately 4.3333 weeks per month, while a custom seven day interval derived from average month length gave approximately 4.3486. The same subscription entered two ways produced two different totals. One constant, one path, no divergence.

**The rounding policy is explicit, because "round only at display" is not achievable here.** Conversion involves a rational rate, and cadence normalisation involves a rational factor, so integer minor units cannot be maintained end to end. The policy instead is:

Internal arithmetic is performed in scaled integers rather than in floating point. Amounts are minor units. Rates are stored as integers in parts per million. Intermediate results are held at a higher scale than the output and are not rounded.

Source adapters must preserve each wire rate as a canonical decimal string; ordinary `JSON.parse` into a JavaScript number is not an acceptable intermediate because it discards the decimal token's exact value before quantisation. Convert that string to an integer numerator and a power-of-ten denominator, multiply by one million, and divide with round half to even. For example, `1.2345675` becomes `1_234_568` PPM because the retained digit is odd, while `1.2345685` also becomes `1_234_568` because the retained digit is already even. Reject zero, negative, non-decimal, non-finite, out-of-policy, and non-safe-integer results. The base currency is always exactly `1_000_000` PPM.

All multiply-and-divide operations use `bigint`. A rate table stores major target-currency units per one major base-currency unit. Therefore a cross-rate is `targetRatePpm × 1_000_000 ÷ sourceRatePpm`. Converting source minor units to target minor units is `amountMinor × targetRatePpm × 10^targetMinorDigits ÷ (sourceRatePpm × 10^sourceMinorDigits)`. For an event enrichment already expressed as USD per event currency, `sourceRatePpm` in that formula is `1_000_000` and `targetRatePpm` is the enrichment rate. This exponent adjustment is mandatory for conversions between currencies with different minor-unit counts.

Convert back to `number` only after a checked `Number.isSafeInteger` boundary; overflow is a validation or calculation error, never a wrapped or approximate value. Persisted `PartsPerMillion` values remain JSON- and SQLite-compatible safe integers, while arithmetic promotes them to `bigint` first. Minor-unit exponents come from the validated currency metadata used by formatting, are converted to bounded powers of ten, and are never inferred by assuming two decimal places.

The brand is a compile-time domain distinction, not a new wire representation. Cache and export encode each PPM value as an ordinary base-ten JSON integer within the safe-integer range; SQLite stores the same integer. Import, cache read, and migration accept a value only after checking that it is a positive safe integer and then reconstruct the brand through the validating constructor. `bigint` intermediates are never serialized or persisted, so no JSON path depends on a non-standard bigint encoding.

There is exactly one signed integer division primitive that implements round half to even. Reviewed call sites use it for decimal-to-PPM quantisation, cross-rate calculation, event snapshot normalisation, and final target-minor-unit conversion. Currency formatting reads the correct minor unit count from `Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits`, because not every currency has two decimal places.

No calculation uses `Math.round`, `toFixed`, a binary floating-point exchange rate, or an unreviewed rounding path. Tests cover exact halves on both sides of even and odd retained digits, positive and negative values where supported by the primitive, zero-decimal and three-decimal currencies, cross-rates, and safe-integer overflow rejection.

### 3.2 Advancing the billing date

Nothing in the model advances `nextBillingDate` on its own, and the application is opened a few times a month, which means billing dates routinely pass between sessions. Without an explicit roll-forward the next billing date silently becomes historical and reminders fire for periods that have already elapsed.

Treat `nextBillingDate` as a local calendar date, not midnight, UTC, or an elapsed-duration timestamp. Compare its ISO date fields with “today” in the user's current local time zone. Roll only while `nextBillingDate` is earlier than today; a billing date equal to today remains due today and is not advanced until the local date changes. After rolling, the invariant is therefore `nextBillingDate >= today`, not strictly in the future. Record the roll-forward without writing a subscription event, since no user action occurred and the recap should not report it as one.

Weekly cadence and custom intervals advance by exact local calendar days. A custom interval of seven means seven date transitions in the user's calendar, never `7 × 24` elapsed hours; daylight-saving changes must not shift the date or time-zone interpretation.

Month-based cadences use the persisted anchor established whenever the user enters or edits the billing date. `billingAnchorDay` is the entered day number, and `billingAnchorIsMonthEnd` is true when the entered date was the final local calendar day of its month. Monthly, quarterly, biannual, and annual advances calculate each target from that anchor rather than from a previously clamped date. A month-end anchor always lands on the target month's final day. A non-month-end anchor lands on `min(anchorDay, daysInTargetMonth)`, then recovers the anchor in a later month: 30 January advances to 28 February and then 30 March, while a 31 January month-end anchor advances to 28 February and then 31 March. Leap-day annual anchors similarly recover 29 February in leap years. Editing the date resets both anchor fields; changing cadence preserves the date-derived anchor.

When `nextBillingDate` exists for a month-based cadence, both anchor fields are required. At user input they must match the entered date; after roll-forward, the day remains in the range 1–31 and the month-end flag remains unchanged even when the current date is clamped. They are absent for weekly and custom cadences. A migration encountering an older month-based record derives the anchor once from its current billing date and records that migration deterministically; it never silently guesses a different anchor on each roll-forward.

Recompute the associated reminder whenever the billing date rolls forward, and whenever the user edits the billing date, the cadence, or the notice period. Cancel and reschedule rather than attempting to patch an existing notification.

This logic is pure and belongs under test from phase one, even though notifications do not exist until phase eight. Cover at minimum: yesterday, today, tomorrow, one interval and many intervals in the past; 30 January clamping and recovery; a 31 January month-end anchor; leap-day annual recovery; quarterly and biannual month steps; a custom interval across both daylight-saving transitions; and a time-zone case where the UTC date differs from the user's local date. Phase eight reuses the same local-calendar primitives to subtract `noticePeriodDays` and tests that reminder deadlines do not move by an hour or a date across daylight-saving changes.

---

## 4. User flows

### 4.1 First run and first subscription

```gherkin
Feature: First run

  Scenario: A new user opens the application with no data
    Given the user has never added a subscription
    When the application loads
    Then an empty state is shown explaining what the application does
    And a single primary action to add a first subscription is visible
    And no error, loading skeleton, or zero total is displayed as though it were data

  Scenario: Adding a first subscription from the catalogue
    Given the user is on the empty state
    When the user activates the add action
    And the user types part of a service name into the service field
    Then a filtered list of matching services is shown
    And each entry displays the service logo and name
    When the user selects a service
    Then the amount, currency, and cadence fields are focused in sequence
    And the currency field defaults to the user's display currency
    When the user enters an amount and confirms
    Then the subscription is persisted before any navigation occurs
    And the overview screen is shown with the new subscription in the list

  Scenario: Adding a service that is not in the catalogue
    Given the user is on the add screen
    When the user types a name that matches no catalogue entry
    Then the combobox offers to create a custom entry with the typed name
    And a neutral monogram avatar is generated in place of a logo
    And the subscription can be saved with no logo and no cancellation link

  @phase1
  Scenario: Phase 1 keeps entries in one currency
    Given the user's primary currency is South African Rand
    When the user adds or edits a subscription in Phase 1
    Then its currency is South African Rand
    And no exchange-rate lookup or conversion occurs

  @phase1
  Scenario: A billing date is due today
    Given a subscription's next billing date equals today in the user's local calendar
    When billing dates are checked
    Then that billing date remains unchanged

  @phase1
  Scenario: A month-based billing date rolls through a short month
    Given a monthly subscription has a non-month-end anchor of day 30
    And its next billing date is 30 January
    When the date is rolled through February and March
    Then the successive billing dates are the final day of February and 30 March
    And the original day 30 anchor is retained
```

### 4.2 Overview

```gherkin
Feature: Overview

  @phase1
  Scenario: Viewing the Phase 1 single-currency total
    Given Phase 1 is running with the user's primary currency set to South African Rand
    And every subscription is recorded in South African Rand
    When the overview screen is shown
    Then one combined monthly total is displayed in South African Rand
    And no United States Dollar conversion is displayed
    And no exchange-rate date or stale-rate label is displayed

  @phase2
  Scenario: Viewing the Phase 2 dual-currency total
    Given the user has at least one subscription
    And a valid rate table is available
    When the overview screen is shown
    Then the combined monthly total is displayed in United States Dollars
    And the same total is displayed in the user's chosen display currency
    And the date of the exchange rates used is visible

  Scenario: Changing the unit of the headline figure
    Given the overview screen is shown
    When the user activates the headline total
    Then the figure changes to the annual equivalent
    And the transition animates as a count from the previous value
    When the user activates it again
    Then the figure changes to the daily equivalent
    When the user activates it again
    Then the figure returns to the monthly equivalent

  Scenario: Reduced motion
    Given the user has requested reduced motion at the system level
    When the headline figure changes unit
    Then the new value is displayed immediately without animation
    And the proportional bars are still rendered, without an entry animation

  Scenario: Ordering and proportion
    Given the user has more than one subscription
    When the list is rendered
    Then subscriptions are ordered from the highest to the lowest monthly equivalent
    And each row displays a bar representing its share of the monthly total

  @phase2
  Scenario: Stale exchange rates
    Given the cached exchange rates are more than twenty-four hours old
    And the device has no network connection
    When the overview screen is shown
    Then totals are calculated from the cached rates
    And a label states the date the rates were retrieved
    And no error state blocks the interface
```

### 4.3 Detail and cancellation

```gherkin
Feature: Subscription detail

  Scenario: Viewing a subscription
    Given the user activates a row on the overview
    Then the detail view shows the amount in its original currency
    And the converted monthly equivalent in United States Dollars
    And the billing cadence and next billing date when known
    And a cancellation action when a route to cancellation is known

  Scenario: Cancelling a directly billed service
    Given a subscription has a billing channel of "direct"
    And the catalogue provides a cancellation URL for that service
    When the user activates the cancellation action
    Then on web the URL opens in a separate browsing context without opener access
    And on native the URL opens in the system browser rather than an embedded view
    And the control is announced as an external link

  Scenario: Cancelling a service billed through a platform
    Given a subscription has a billing channel of "apple" or "google"
    When the user activates the cancellation action
    Then the platform subscription management screen is opened
    And on web, where no platform deep link is possible, instructions are shown instead

  Scenario: A user-supplied cancellation link
    Given a subscription has a cancellation URL override
    When the user activates the cancellation action
    Then the override is used in preference to the catalogue value

  Scenario: A cancellation destination fails navigation validation
    Given a persisted cancellation destination is no longer a valid absolute HTTPS URL
    When the user activates the cancellation action
    Then no navigation occurs
    And a neutral message explains that the destination cannot be opened
    And the invalid value is not passed to the browser or operating system

  Scenario: A service with no cancellation URL
    Given a subscription has no catalogue URL and no override
    Then the cancellation action is replaced by a field inviting the user to add one
    And any cancellation note recorded by the user is displayed
```

### 4.4 Removal, undo, and the freed-up tally

```gherkin
Feature: Removing a subscription

  Scenario: Removing by swipe
    Given the user is on the overview
    When the user swipes a row past the removal threshold
    Then a haptic impact fires at the moment the threshold is crossed
    When the user releases the swipe
    Then the row is removed from the list
    And a message states the monthly and annual amount that has been freed up
    And an undo action is available for at least six seconds

  Scenario: Removing without a swipe
    Given the user cannot or does not wish to perform a swipe gesture
    When the user opens the subscription detail view
    Then a remove action is available as a single-pointer control
    And activating it produces the same outcome as the swipe

  Scenario: Undoing a removal
    Given a subscription has just been removed
    When the user activates the undo action
    Then the subscription is restored to the list in its previous position
    And the freed-up tally returns to its previous value
    And a "restored" event is recorded

  Scenario: The freed-up tally
    Given the user has removed at least one subscription
    When the overview screen is shown
    Then a cumulative total of the monthly amount freed up is displayed
    And that total excludes any subscription that was subsequently restored
```

### 4.5 Reminders

```gherkin
Feature: Cancellation reminders

  Scenario: Setting a reminder from a notice period
    Given a subscription has a next billing date and a notice period in days
    When the subscription is saved on a native platform
    Then a local notification is scheduled for the last day on which cancelling
      avoids the next charge

  Scenario: Reminder fires
    Given a scheduled reminder date arrives
    Then a notification states which subscription is affected and the deadline
    When the user activates the notification
    Then the application opens directly on that subscription's detail view

  Scenario: Reminder is cleared
    Given a subscription with a scheduled reminder is removed
    Then the scheduled notification is cancelled
```

### 4.6 Data safety

```gherkin
Feature: Export and import

  Scenario: Exporting a backup
    Given the user has at least one subscription
    When the user chooses to export
    Then a JSON file containing all subscriptions, events, rate enrichments, and settings is produced
    And the file includes a schema version and an export timestamp

  Scenario: Importing a backup
    Given the user selects a previously exported file
    When the schema version is supported
    Then the user is asked whether to merge with or replace existing data
    And the chosen operation completes atomically

  Scenario: Merging records that exist on both sides
    Given the user has chosen to merge
    And a record in the file shares an identifier with an existing record
    When the record in the file has a later "updatedAt" value
    Then the incoming record replaces the existing one
    When the record in the file has an earlier or equal "updatedAt" value
    Then the existing record is retained unchanged

  Scenario: Merging the event log
    Given the user has chosen to merge
    Then events are combined as a union keyed on event identifier
    And rate enrichments are combined as a union keyed on their event identifier
    And no event or enrichment is ever overwritten, because both are immutable
    And a same-key record with different content rejects the merge as a conflict
    And the freed-up tally is recomputed from the combined log

  Scenario: Replacing rather than merging
    Given the user has chosen to replace
    Then the user is warned that existing data will be discarded
    And an automatic export of the current data is offered before proceeding

  Scenario: Importing an unsupported file
    Given the user selects a file that is not a valid export
    Then a clear message explains that the file could not be read
    And no existing data is modified

  Scenario: Persistent storage is not granted
    Given the first subscription has been saved successfully on web
    And the persistence API is absent, returns false, or rejects
    Then the save remains successful
    And the recorded persistence state is unsupported, denied, or error respectively
    And the interface does not claim that the data is backed up
    And non-blocking export guidance and its export action remain visible while persistence is not granted
```

### 4.7 Biometric lock

```gherkin
Feature: Application lock

  Scenario: Lock enabled
    Given the user has enabled biometric lock on a native platform
    When the application is opened or returns from the background
    Then the user is prompted for biometric authentication before data is shown

  Scenario: Biometric authentication unavailable
    Given biometric authentication fails or is unavailable on the device
    Then the device passcode fallback is offered
    And the user is never permanently locked out of their own data
```

---

## 5. Interaction and delight specification

### 5.1 Where personality lives

Personality is front-loaded and moment-based. It belongs in first run, in the reveal of the annual figure, in removal, and in the annual recap. The routine surfaces stay calm. A joke that is pleasant on first encounter becomes an irritant on the fortieth, so nothing that recurs on every session may be novel.

### 5.2 The proportional list

The ordering already carries information. Render it. Each row displays a bar whose length represents that subscription's share of the monthly total. One large bar above a long tail of small ones tells a completely different story from twelve similar bars, and the user reads that story in under a second.

This is the highest-value visual element in the product. It is simultaneously the most useful and the most distinctive thing on the screen, and it costs almost nothing at runtime.

### 5.3 The headline figure

Activating the total cycles between monthly, annual, and daily. The annual figure is usually the one that changes behaviour. Animate the change as a count from the previous value using a custom property registered with `@property`, since unregistered custom properties animate discretely.

### 5.4 Removal as reward

The message that follows a removal states what has been freed up in both monthly and annual terms. It does not say "Deleted".

A cumulative freed-up total is displayed persistently on the overview. This figure is the reason to return to the application, and it is the thing users will describe in reviews.

### 5.5 Haptics

Haptics fire only on state changes, never on ordinary taps. Over-use is worse than absence.

Three moments carry haptics. During the count of the annual figure, fire selection ticks at an accelerating rate and finish with a single impact when the value settles. At the swipe removal threshold, fire a light impact at the moment the threshold is crossed rather than on release, so the user knows the action is armed before committing. On removal confirmation, fire a success notification pattern.

Tune patterns per platform. Android haptic hardware is less expressive than the Taptic Engine, and a pattern that reads as refined on an iPhone can read as buzzy elsewhere. Provide a settings toggle regardless of platform.

### 5.6 Colour from the catalogue

Each catalogue entry carries an accent colour. Apply it at low chroma in OKLCH as a card tint or an edge, which produces visual variety drawn from the user's own data rather than from arbitrary decoration, without abandoning a restrained palette.

### 5.7 Copy

The register is dry and understated rather than exclamatory. It translates more safely and ages better.

Humour is prohibited in export and import flows, in any message about data loss, and in any label concerning the accuracy or age of exchange rates. A joke placed next to a financial figure undermines confidence in the figure.

### 5.8 The annual recap

Ships last, but the event log that makes it possible ships first. The recap covers the highest and lowest monthly totals across the year, what was added, what was removed, the cumulative amount freed up, and the subscription held longest. It is designed to be screenshot and shared, which is the realistic discovery mechanism for a product with no marketing budget.

---

## 6. Design system

### 6.1 Typography

Define a modular scale from a single ratio. A minor third at 1.2 or a major third at 1.25 both produce a restrained result appropriate to the product. Express every step as a custom property derived from the ratio, and use `clamp()` for fluid sizing so that type scales without breakpoint jumps. Cap the upper bound so that line lengths stay readable.

Apply `font-variant-numeric: tabular-nums` to every element that displays a currency amount, so that figures align in columns and do not shift width as values change.

### 6.2 Colour

Author the palette in OKLCH with hexadecimal fallbacks declared first. Perceptual uniformity means a tint and shade ramp generated from one base hue produces evenly spaced steps rather than the uneven results of interpolating in sRGB.

Register any custom property that is animated using `@property`, with an explicit `syntax`, `inherits`, and `initial-value`.

Support `prefers-color-scheme` and `prefers-reduced-motion` from the first slice. Both are inexpensive, and the absence of either is the kind of thing that produces a low store rating with a one-line explanation.

### 6.3 CSS methodology

Follow Shared First. Only declarations that hold at every viewport size live outside a media query. Everything else lives inside a bounded range query using Media Queries Level 4 comparison syntax, with each breakpoint self-contained rather than relying on cascade from a smaller size. The same rule applies to container queries.

Use BEM for naming, logical properties rather than physical, and relative units unless the context genuinely requires pixels. No CSS-in-JS.

### 6.4 Accessibility requirements

Semantic HTML first, ARIA only where no native element provides the semantics.

Every interactive target meets at least twenty-four by twenty-four CSS pixels, and primary touch actions should aim considerably higher. Focus indicators must be visible and must not be obscured by sticky elements.

Swipe to remove is an enhancement only. A single-pointer, non-drag alternative must always be present and reachable by touch, because a keyboard-only alternative does not satisfy the requirement on a mobile device.

The combobox must be tested on a real iOS device with VoiceOver and a real Android device with TalkBack. This is a planned task in the phase where the combobox ships, not an afterthought.

---

## 7. Testing strategy

Test-driven throughout.

Vitest covers the pure logic, which is where most of the risk sits. That includes cadence normalisation through the rational days-per-month constant; decimal-string-to-PPM quantisation; half-even division, checked `bigint` arithmetic, currency conversion, and cross-rates; billing-date anchors and local-calendar roll-forward; the freed-up tally including the restore case; catalogue matching and alias resolution in the combobox filter; cancellation URL validation at catalogue, cache, import, persistence, and navigation boundaries; forward schema migrations plus explicit rejection of data from unsupported newer schema versions; and import validation against malformed and hostile files.

Rate tests use fixed decimal strings and expected integer PPM values rather than calculating expectations through the implementation. Billing-date tests set the local date and time zone explicitly and cover today, short-month clamp and anchor recovery, leap years, many missed periods, and custom-day intervals across daylight-saving boundaries. Event tests prove that captured enrichment is inserted atomically with its event, that backfill is insert-if-absent, that same-key conflicts cannot overwrite a record, and that no later rate table can alter an existing enrichment.

The repository contract is defined once and executed against both the IndexedDB and SQLite implementations, so that a divergence between platforms is a test failure rather than a support ticket.

The contract suite does not, however, exercise the real native SQLite engine. Under Vitest it runs against the plugin's web or WebAssembly path, or against a Node shim, neither of which is what ships to a device. The contract tests prove that the two implementations agree on behaviour. They do not prove that the native engine behaves as expected. Phase seven therefore includes a small on-device smoke test covering write, read, migration, and survival across an application restart, executed on real iOS and Android hardware. Treat that as a gate on the phase rather than as optional verification.

Playwright is a web-only gate. The Desktop Chrome CI project covers only these four named web cases:

- visual regression on the overview screen;
- keyboard navigation through the combobox;
- the reduced-motion path; and
- the web install prompt.

It does not broadly claim every flow in section 4 and does not test a system browser handoff, native SQLite, local-notification delivery, haptics, biometrics, Capacitor lifecycle behaviour, VoiceOver, or TalkBack. Additional web scenarios may be added under an explicit web label, but they do not replace the native gates below.

Native verification is explicit and phase-gated:

- Phase four cannot complete until the combobox's filtering, selection, focus return, and error states pass on real iOS hardware with VoiceOver and real Android hardware with TalkBack.
- Phase seven cannot complete until real iOS and Android builds pass SQLite write/read/migration/restart survival, external HTTPS cancellation handoff, lifecycle billing-date roll-forward, the specified haptics, and biometric lock with device-passcode fallback.
- Phase eight cannot complete until real iOS and Android devices prove notification permission states, scheduling from local calendar dates, delivery, cancellation, restart persistence, and tap-to-detail deep linking across foreground, background, and terminated states.
- Phase nine cannot complete until release-signed builds pass installation, upgrade, export/import, offline launch, and the applicable store pre-submission checks on both platforms.

---

## 8. Phased delivery

Each phase after phase zero is a vertical slice that produces something a user can actually do. No phase leaves the application in a state that cannot be demonstrated.

### Phase 0 — Foundations

Repository, build tooling, Vitest and Playwright harnesses, continuous integration. Design tokens, the type scale, the colour system, the bundled and subsetted font with fallback metric overrides. The storage repository interface with the IndexedDB implementation and its contract test. Not user-facing, but everything after this depends on it, and retrofitting the design system after three slices means rewriting them.

### Phase 1 — Record a subscription and see the cost

A plain native select for the service, manual entry for everything else, the sorted list, and exactly one total in the user's primary currency. Phase one neither fetches exchange rates nor displays a second total or rate-age label. Export and import ship here, not later. Durable storage is requested on first successful save, and all four persistence outcomes plus the eviction caveat and the iOS installation/export guidance described in section 2.4 ship with it. The event log is written from the first record in the entered primary currency; no `EventRateEnrichment` records exist until rates ship. The local-calendar billing-date roll-forward and anchor fields from section 3.2 are implemented and tested here, ahead of the notifications that will depend on them.

At the end of this phase the application is useful to one person with one currency, and their data is as safe as the platform permits.

### Phase 2 — Multiple currencies

The Frankfurter integration with daily caching, the fallback source, the stale rate label, and exactly two totals: United States Dollars and the chosen display currency. Source adapters preserve decimal tokens, cache only validated integer `ratesPpm`, and use checked `bigint` arithmetic and half-even quantisation as specified in section 3.1. Conversion and rounding are the highest-risk logic in the product and receive the most test coverage.

Events created after rates are available atomically receive an immutable captured `EventRateEnrichment` record. This phase also inserts one backfilled enrichment for each previously unenriched phase-one event. Backfill uses the current valid rate table at enrichment time, records `provenance: "backfilled"` plus source and both timestamps, and relies on the unique event key to prevent overwrite or duplicate insertion. Phase-two acceptance includes captured, backfilled, concurrent insert-if-absent, immutable replay, stale-rate, offline-cache, exact-half, and overflow scenarios.

### Phase 3 — Manage subscriptions

Detail view, editing, removal with undo, the freed-up tally, and the cancellation link including the billing channel field, the user override, and the cancellation note. Catalogue and user destinations are restricted to absolute HTTPS and are revalidated immediately before navigation as specified in section 2.6. The soft-delete model and the restore path are proven here.

### Phase 4 — Fast, pleasant entry

The service catalogue as a versioned JSON file with bundled fallback, validation before cache replacement and on cache read, the bundled svgl logos with monogram fallback, and the Zag.js combobox replacing the native select. The real-device VoiceOver and TalkBack scenarios in section 7 are a gate on completing this phase.

### Phase 5 — Make it feel like something

The proportional bars, the count animation on the headline figure with the unit cycle, catalogue accent colours, the reduced-motion paths, and a full pass on copy. This phase is where the product stops looking like every other tracker.

### Phase 6 — Installable

Web application manifest with maskable icons and screenshots, service worker with an offline shell, and `beforeinstallprompt` handling on Chromium. The iOS instructional install path already shipped in phase one for data safety reasons, and is refined rather than introduced here.

### Phase 7 — Native

Capacitor shells for both platforms, the SQLite repository implementation running against the existing contract tests, haptics, and biometric lock. All phase-seven native scenarios in section 7 are a gate on completing this phase, since the contract tests and Playwright alone do not exercise the shipped engines or operating-system integrations.

Recruit Google Play testers at the start of this phase rather than at phase nine.

### Phase 8 — Reminders

Local notification scheduling driven by the next billing date and notice period, deep linking from a notification into the relevant detail view, and cancellation of scheduled notifications when a subscription is removed. The phase-eight real-device notification matrix in section 7 is a completion gate.

### Phase 9 — Store submission

Privacy manifest and App Privacy details for Apple, the Data safety declaration for Google, a published privacy policy, and store creative that contains no third-party brand logos. Target the current required Android API level.

If the Google Play developer account is a personal account created after November 2023, the closed testing requirement applies, which currently means at least twelve testers opted in continuously for fourteen days. Recruit testers at the start of phase seven, because this is the longest lead time in the entire project and it is invisible until it blocks release.

### Phase 10 — Annual recap

Built from the event log accumulated since phase one.

---

## 9. Items to verify at implementation time

The following are accurate as of the plan's writing but sit in areas that change on a quarterly cadence, and should be checked against primary sources rather than trusted from this document.

Apple's required SDK version for new submissions, privacy manifest enforcement details, and current screenshot requirements. Google's target API level deadline. Frankfurter's terms and currency coverage. The licensing and trademark notes attached to individual entries in the logo sets.

Two items previously listed here have since been checked and are recorded as settled.

Customizable `<select>` shipped in Safari 27 beta on 8 June 2026, joining Chromium support from Chrome 135. The combobox decision stands regardless, because it rests on the filtering requirement rather than on browser support. Do not revisit it on support grounds.

The Google Play closed testing requirement is current as described: at least twelve testers opted in continuously for fourteen days, applying to personal developer accounts created after 13 November 2023, reduced from twenty in December 2024.
