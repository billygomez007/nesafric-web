# NesAfric Recurring & Additional Charges

## Objective

Add a proper charge-management system to NesAfric so landlords,
property managers, real-estate organisations, and developers can charge
tenants for costs that exist separately from base rent.

Examples:

- Service charge
- Waste / trash collection
- Electricity
- Water
- Security
- Cleaning
- Parking
- Facility / estate charge
- Internet
- Generator / fuel
- Maintenance levy
- Common-area charge
- Custom charge

This feature must NOT silently merge miscellaneous charges into the
existing rent amount.

Rent must remain separately identifiable throughout:

- lease economics
- obligations
- collections
- receipts
- financial ledger
- arrears
- reminders
- reporting

---

# 1. Core business concepts

The platform needs two separate concepts:

## Charge Definition

A reusable configuration describing what should be charged.

Examples:

- "Estate service charge — GHS 350 monthly"
- "Waste collection — GHS 60 monthly"
- "Electricity — variable monthly"
- "Parking — GHS 200 monthly"
- "Move-in cleaning fee — GHS 500 once"

A definition may exist at:

- organisation level
- property level
- unit level
- lease level

A more specific assignment may override or supplement a broader one.

## Charge Obligation

The actual amount owed by a tenant for a specific billing period.

Example:

Definition:
Waste charge = GHS 60 monthly

Generated obligations:
2026-10-01 = GHS 60
2026-11-01 = GHS 60
2026-12-01 = GHS 60

Obligations must be immutable financial records once billed, except
through explicit adjustment / cancellation workflows.

---

# 2. Charge categories

Support an enum similar to:

SERVICE_CHARGE
WASTE
ELECTRICITY
WATER
SECURITY
CLEANING
PARKING
INTERNET
GENERATOR_FUEL
MAINTENANCE_LEVY
COMMON_AREA
OTHER

Display labels may be user-friendly.

OTHER requires a custom label.

---

# 3. Charge calculation type

Support:

FIXED
VARIABLE

FIXED:
The amount is known when the charge is configured.

Example:
GHS 100 monthly waste charge.

VARIABLE:
The amount changes per billing cycle.

Example:
Electricity usage for September = GHS 275.

For a VARIABLE charge, the platform should generate a draft/unbilled
charge period and require an authorised staff member to enter the amount
before it becomes due.

Do not invent utility-meter calculations unless a meter-reading feature
already exists.

---

# 4. Charge frequency

Support at minimum:

ONE_TIME
MONTHLY
QUARTERLY
ANNUAL
CUSTOM

Use calendar-aware recurring generation.

Never approximate:
monthly = 30 days
annual = 365 days

Use real calendar periods.

---

# 5. Charge scope

A charge definition can be attached to:

PROPERTY
UNIT
LEASE

Possible future scope:
ORGANISATION

Initial operational behaviour:

PROPERTY:
Charge can apply to eligible leases/tenants in the property.

UNIT:
Charge applies to the lease occupying the specified unit.

LEASE:
Charge applies only to that lease.

The user must be able to choose whether a property-level charge applies:

- automatically to all active leases
- only to selected units/leases

Do not create obligations for archived, expired, cancelled, or
terminated leases unless explicitly required by an already-existing
financial period.

---

# 6. Included-in-rent behaviour

Each charge definition must have:

billingMode:

SEPARATE
INCLUDED_IN_RENT

SEPARATE:
Creates its own charge obligation and outstanding balance.

INCLUDED_IN_RENT:
Displayed as an informational rent component but MUST NOT create an
additional amount due on top of the rent obligation.

This prevents accidental double charging.

---

# 7. Suggested database architecture

Introduce models conceptually equivalent to:

PropertyChargeDefinition
ChargeObligation
ChargePaymentAllocation
ChargeAdjustment

Names may be adapted to the repository's conventions.

PropertyChargeDefinition fields should include:

id
organisationId
propertyId?
unitId?
leaseId?
category
customLabel?
description?
calculationType
frequency
customFrequency?
billingMode
amountMinor?
currencyCode
dueDayOfMonth?
startDate
endDate?
notifyTenant
enabled
createdByUserId
createdAt
updatedAt
archivedAt?

ChargeObligation fields should include:

id
organisationId
chargeDefinitionId
leaseId
tenantOrganisationId
propertyId
unitId?
periodStart
periodEnd
dueDate
amountMinor
currencyCode
status
collectionState
collectedAmountMinor
description snapshot
createdAt
updatedAt

The obligation must snapshot:
- label
- category
- amount
- currency

so changing a future charge definition does not rewrite past financial
history.

---

# 8. Charge obligation statuses

Use a lifecycle conceptually similar to:

DRAFT
UPCOMING
DUE
OVERDUE
SATISFIED
CANCELLED

VARIABLE obligations may begin as DRAFT.

A charge must not be collectible until an amount is finalised.

---

# 9. Collection state

Use the existing rent collection semantics where possible:

UNPAID
PARTIALLY_PAID
FULLY_PAID

Do not overload RentObligation itself to represent non-rent fees.

---

# 10. Payments

Current payments allocate to RentObligation.

Extend payment allocation safely so one payment can be allocated across:

- rent obligations
- charge obligations

Example payment:

Tenant pays GHS 1,600

Rent:
GHS 1,400

Waste:
GHS 50

Service charge:
GHS 150

Receipt:
Total GHS 1,600

Allocation breakdown:
Rent          GHS 1,400
Waste         GHS    50
Service fee   GHS   150

Existing rent-only behaviour must remain backward compatible.

No existing payment, receipt, or ledger semantics may be silently
changed.

---

# 11. Payment priority

Allow explicit allocation first.

If automatic allocation is used, use a documented deterministic rule.

Suggested default:

1. overdue rent
2. overdue mandatory charges
3. current rent
4. current mandatory charges
5. optional / future balances

Do NOT implement this priority silently without tests and UI disclosure.

---

# 12. Ledger

Extend LedgerEntryType safely with a charge-specific entry such as:

ADDITIONAL_CHARGE
ADDITIONAL_CHARGE_PAYMENT
ADDITIONAL_CHARGE_ADJUSTMENT

or another architecture consistent with the existing ledger.

The ledger must clearly distinguish:

RENT_CHARGE

from:

SERVICE_CHARGE
WASTE
ELECTRICITY
etc.

Do not label all income as rent.

---

# 13. Receipts

Receipt details should eventually show allocation breakdown.

Example:

Payment received: GHS 1,600

Applied to:
Rent — October 2026          GHS 1,400
Waste — October 2026         GHS    50
Service charge — Oct 2026    GHS   150

Total                         GHS 1,600

Existing historical receipts remain unchanged.

---

# 14. Tenant reminders

Extend the notification architecture with charge-specific events.

Suggested events:

CHARGE_UPCOMING
CHARGE_DUE
CHARGE_OVERDUE
CHARGE_UPDATED
CHARGE_PAID

Use existing channels:

IN_APP
EMAIL
SMS
WHATSAPP

Respect existing tenant communication preferences.

Example reminder:

"Your October waste collection charge of GHS 60 is due on
5 October."

Example combined reminder:

"Your October balance is GHS 1,610:
Rent GHS 1,400
Service charge GHS 150
Waste GHS 60."

Combined notifications are desirable but must not create duplicate
notifications.

---

# 15. Reminder configuration

Landlord/admin can configure:

- notify tenant yes/no
- number of days before due date
- on due date
- overdue reminder cadence
- channels

At minimum, support existing ReminderPolicy concepts rather than
creating a completely separate notification engine.

---

# 16. Property UI

Inside each property detail page add a section:

Charges & Utilities

Show:

- active charge definitions
- amount
- category
- recurrence
- billing mode
- affected scope
- next billing date
- notification status

Actions:

Add charge
Edit future configuration
Disable future billing
View obligations

Never allow editing a definition to mutate already-issued obligations.

---

# 17. Add Charge form

Fields:

Charge name
Category
Description
Scope
Unit / lease selector when applicable
Calculation type
Amount
Currency
Frequency
Due date/day
Start date
End date
Separate or included in rent
Notify tenant
Reminder timing
Enabled

Examples should make the UI understandable.

---

# 18. Lease UI

Lease detail should show:

Monthly / recurring financial summary.

Example:

Base rent:
GHS 1,400 / month

Additional recurring charges:
Service charge    GHS 150
Waste             GHS  60

Expected recurring total:
GHS 1,610 / month

Do not add INCLUDED_IN_RENT charges to the total a second time.

---

# 19. Tenant UI

Tenant detail should show:

Current outstanding:
Rent
Additional charges
Total balance

Upcoming:
Next rent
Next service charge
Next waste charge
etc.

History:
Paid / unpaid / overdue charges.

---

# 20. Payments UI

Manual payment and checkout surfaces should show:

Rent balance
Other charges
Total outstanding

Allow explicit allocations where existing payment permissions permit.

Do not force an additional charge into rent allocation.

---

# 21. Dashboard

Add relevant metrics only when useful:

Outstanding rent
Outstanding additional charges
Total receivables

Optional later:
Charge collection rate
Utilities outstanding
Service charge outstanding

---

# 22. Variable utility charges

For electricity/water and similar:

A landlord must be able to create a variable recurring charge definition.

Each period should allow an authorised user to enter:

amount
description / note
optional evidence/document reference

Example:

Electricity
September 2026
GHS 284.50

Do not automatically send the tenant a charge before the variable amount
is finalised.

---

# 23. Adjustments and cancellations

Financial history must be auditable.

Do not hard-delete issued obligations.

Use actions such as:

cancel
waive
adjust

with:

reason
actor
timestamp
old amount
new amount

where applicable.

---

# 24. Organisation isolation

Every charge query and mutation must enforce:

organisationId

Never trust organisationId from the request body alone.

Use existing organisation membership and permission architecture.

---

# 25. RBAC

Add or reuse permissions for:

charge.read
charge.manage
charge.bill
charge.adjust

Adapt names to existing PERMISSIONS conventions.

Tenant self-service must only see obligations belonging to their own
TenantOrganisation.

---

# 26. Idempotency

Recurring generation must be idempotent.

Running the generator multiple times must NOT duplicate the same charge
obligation.

Suggested unique identity includes:

chargeDefinitionId
leaseId
periodStart
periodEnd

---

# 27. Background jobs

Use the existing durable job infrastructure.

Required jobs may include:

generate_charge_obligations
mark_charge_due
mark_charge_overdue
schedule_charge_reminders

Reuse existing scheduling architecture where possible.

Do not introduce a parallel job runner.

---

# 28. Audit events

Record meaningful actions:

charge_definition.created
charge_definition.updated
charge_definition.disabled
charge_obligation.created
charge_obligation.finalised
charge_obligation.adjusted
charge_obligation.cancelled
charge.payment_allocated

---

# 29. Domain events

Emit domain events where useful so AI, communications, analytics and
future accounting integrations can consume them.

Suggested events:

charge.created
charge.due
charge.overdue
charge.paid
charge.adjusted

---

# 30. AI Workforce

Do not let AI autonomously create financial charges.

The AI Property Manager may:

- explain charge balances
- detect upcoming/overdue charges
- draft reminders
- propose a new charge

Creating, changing, waiving or adjusting financial charges must remain
permission/approval controlled according to existing AI safety rules.

---

# 31. Backward compatibility

Existing leases with no additional charges must behave exactly as before.

Existing rent obligations must remain rent obligations.

Existing payments must remain valid.

Existing receipts must remain valid.

Existing ledger history must remain valid.

Existing notification behaviour must remain valid.

No destructive data migration.

---

# 32. Testing requirements

At minimum test:

1. fixed monthly charge generation
2. quarterly charge generation
3. one-time charge
4. variable charge remains draft until amount entered
5. property charge applies to correct leases
6. unit charge applies only to matching unit
7. lease charge applies only to matching lease
8. included-in-rent does not double bill
9. repeated generator run is idempotent
10. due status transition
11. overdue status transition
12. partial allocation
13. full allocation
14. mixed rent + charge payment allocation
15. reversal restores balances correctly
16. organisation isolation
17. RBAC
18. tenant self-service isolation
19. reminder generation
20. communication preferences
21. disabled charge creates no future obligations
22. changing charge definition does not rewrite historical obligations
23. currency mismatch rejected
24. receipts show correct total/allocation
25. ledger distinguishes rent and other charges

---

# 33. Migration safety

This feature requires schema changes.

Rules:

- create a new additive migration
- no destructive reset
- no db push against Production
- no migration against Production during development
- test against localhost propertyos database only
- inspect generated SQL before applying locally
- preserve all existing records

---

# 34. Initial delivery checkpoint

The first implementation checkpoint should deliver:

- database models/enums
- migration
- service layer
- API routes
- property Charges & Utilities UI
- lease recurring financial summary
- generation job
- reminders
- payment allocations
- ledger support
- tests

Then stop for review before broader dashboard/reporting enhancements.
