# NesAfric Recurring Charges — Phase 4B

## Objective

Phase 4B builds the recurring-charge management experience on top of the completed and secured Phase 4A recurring-charge foundation.

Phase 4A must remain intact.

## Phase 4A baseline

Completed commit:

`7956ac2b9dbcb4dc312fd16c5fccfffe5124dc15`

Phase 4A already provides:

- recurring charge definitions
- charge obligations
- fixed charges
- variable charges
- one-time charges
- weekly charges
- monthly charges
- quarterly charges
- semi-annual charges
- annual charges
- deterministic charge generation
- idempotent generation
- obligation finalisation
- obligation waiving
- historical snapshots
- organisation isolation
- lease.read authorization for reads
- lease.update authorization for writes
- PostgreSQL uniqueness protections
- API routes
- domain tests
- generator tests
- RBAC tests
- PostgreSQL integration tests

## Phase 4B scope

Phase 4B adds the product-facing management experience.

### 1. Recurring Charges workspace

Create an authenticated organisation-scoped workspace for recurring charges.

The workspace should allow authorised users to:

- view recurring charge definitions
- create recurring charge definitions
- edit definitions
- archive definitions
- inspect definition details
- generate obligations
- inspect generated obligations
- finalise variable obligations
- waive obligations where permitted

### 2. Primary route

Add a workspace route consistent with the existing NesAfric dashboard architecture.

Preferred route:

`/dashboard/recurring-charges`

If the existing application uses a different workspace route convention, follow the existing convention instead of inventing a second navigation architecture.

### 3. Recurring charge list

The main recurring-charge page should display:

- charge name
- charge type
- fixed or variable
- amount
- currency
- frequency
- property
- unit where applicable
- lease
- tenant
- start date
- end date where applicable
- due-day configuration
- active/archive state
- generated obligation count where safely available

Provide appropriate empty, loading and error states.

### 4. Create charge flow

Create a production-quality form for recurring-charge definitions.

Required fields and controls should map directly to the existing Phase 4A schema and API.

Support:

- fixed amount charges
- variable amount charges
- one-time
- weekly
- monthly
- quarterly
- semi-annual
- annual

Do not expose unsupported CUSTOM recurrence behavior unless the backend explicitly supports safe scheduling for it.

The form must dynamically adapt to charge type and frequency.

### 5. Edit charge flow

Allow authorised users to edit future configuration through the existing secured API.

Do not mutate historical generated obligation snapshots.

The UI must clearly distinguish:

- definition changes
- historical obligations
- future generated obligations

### 6. Charge details

Provide a details view showing:

- definition metadata
- associated organisation
- property
- unit
- lease
- tenant
- frequency
- amount configuration
- start and end dates
- due-day configuration
- generated obligations
- archived state

### 7. Obligation management

Create an obligation list with:

- period
- due date
- original snapshot amount
- current/final amount
- status
- finalised state
- waived amount/state
- tenant
- property
- lease

Supported statuses must come from the existing Phase 4A domain rather than duplicated frontend constants.

### 8. Variable charge finalisation

For variable obligations that are still draft:

- provide a finalise action
- require the amount
- use the secured Phase 4A finalise API
- display confirmation before mutation
- refresh affected queries after success
- show backend errors safely

### 9. Waiving charges

For eligible obligations:

- provide a waive action
- require explicit confirmation
- capture the supported waiver input from the Phase 4A schema
- use the secured Phase 4A waive API
- do not directly modify payment records

### 10. Generate obligations

Allow authorised users to run generation for a selected recurring charge through the existing secured API.

The UI should clearly communicate that generation is idempotent.

Do not provide controls that bypass backend uniqueness protections.

### 11. RBAC

Do not recreate authorization rules in the browser.

Backend remains authoritative.

Expected backend rules:

- recurring charge reads require lease.read
- mutations require lease.update
- membership must be ACTIVE
- organisation context must be valid

Frontend may hide or disable unavailable controls for usability, but this is not a security boundary.

### 12. Organisation isolation

Every request must use the currently selected organisation through the application's existing organisation-context mechanism.

Never accept arbitrary organisation IDs from user-editable form fields.

Do not create cross-organisation selectors.

### 13. Payment safety

Phase 4B must NOT redesign or alter the existing payment allocation, reconciliation, ledger or receipt architecture.

Recurring charge obligations represent amounts due.

Payment settlement remains governed by the existing payments domain.

Do not:

- auto-mark obligations as paid from the frontend
- directly mutate allocations
- bypass reconciliation
- create duplicate payment ledgers
- replace existing receipt behavior

### 14. Design quality

Use the existing NesAfric dashboard design system and components.

Do not introduce a separate visual language.

Provide:

- responsive desktop layout
- responsive tablet layout
- usable mobile layout
- accessible labels
- keyboard-friendly forms
- clear validation
- clear success and failure states
- confirmation dialogs for destructive actions

### 15. Data fetching

Follow the application's existing client/server data-fetching pattern.

Do not introduce a second global state framework solely for recurring charges.

Avoid duplicate requests.

Revalidate or refresh only affected data after mutations.

### 16. Testing

Add tests for the Phase 4B management experience.

At minimum verify:

- list rendering
- empty state
- create-form validation
- fixed charge submission
- variable charge submission
- frequency-specific fields
- edit behavior
- archive behavior
- obligation rendering
- variable-charge finalisation
- waive confirmation
- generation action
- error states
- read-only permission experience
- organisation context propagation

Keep all Phase 4A tests passing.

### 17. Safety constraints

Do not:

- deploy production
- run production migrations
- modify main
- modify payment allocation logic
- weaken Phase 4A RBAC
- remove organisation scoping
- rewrite historical obligation snapshots
- silently expand Phase 4B into accounting or payment architecture

## Phase 4B acceptance criteria

Phase 4B is complete only when:

1. recurring charges can be managed from the NesAfric authenticated workspace
2. charge definitions can be created and viewed
3. supported definitions can be edited/archived safely
4. obligations can be viewed
5. variable obligations can be finalised
6. eligible obligations can be waived
7. generation can be triggered safely
8. organisation isolation remains enforced
9. RBAC remains enforced
10. payment architecture remains untouched
11. Phase 4A tests remain green
12. new Phase 4B tests pass
13. TypeScript passes
14. ESLint passes
15. build passes where safe to run locally
16. no production operation has occurred
