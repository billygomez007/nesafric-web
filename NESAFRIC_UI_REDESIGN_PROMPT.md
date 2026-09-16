# NESAFRIC COMPLETE REFERENCE-BASED UI REDESIGN

Repository:
billygomez007/nesafric-web

Reference image inside this repository:

design/reference/nesafric-approved-reference.png

This image is the APPROVED VISUAL SOURCE OF TRUTH.

Interpret the image as follows:

- TOP / UPPER PART = public NesAfric marketing website and homepage design direction.
- BOTTOM / LOWER PART = authenticated NesAfric dashboard design direction.

The entire product must use the same visual language:

- deep forest green
- emerald/teal
- premium restrained gold
- warm ivory
- cream
- white
- premium property imagery
- spacious layouts
- clean typography
- subtle borders
- restrained shadows
- international PropTech quality

Official product:

NesAfric

Positioning:

Real Estate OS for Africa

## IMPORTANT SAFETY RULES

This is primarily a frontend/UI/UX redesign.

Do not:

- rebuild the backend
- change database schemas
- create migrations
- alter Production data
- weaken auth
- weaken RBAC
- remove working APIs
- remove working features
- change payment logic
- change subscription logic
- change marketplace business logic
- change DNS
- deploy Production

Preserve:

- authentication
- workspaces
- roles
- RBAC
- subscriptions
- entitlements
- property management
- tenants
- leases
- payments
- maintenance
- marketplace
- service professionals
- developers
- leads
- messaging
- reports
- notifications
- AI features
- Platform Admin
- SEO
- sitemap
- robots

## PHASE 1 — AUDIT

Before editing, inspect:

- src/app
- layouts
- route groups
- public components
- authenticated layouts
- dashboard
- navigation
- sidebar
- RBAC
- entitlement logic
- marketplace
- forms
- tables
- cards
- charts
- responsive behavior
- Tailwind/CSS
- design tokens
- auth
- onboarding
- header
- footer
- SEO

Internally classify:

KEEP
RESTYLE
REFACTOR
REPLACE
DO NOT TOUCH

Then implement.

Do not stop at the audit.

## DESIGN TOKENS

Create a centralized design system approximately using:

Deep Forest:
#002F2B

Forest:
#003F3A

Emerald:
#006B5F

Teal:
#009B8C

Light Teal:
#35BDAA

Premium Gold:
#C99A45

Soft Gold:
#D9B76C

Light Gold:
#E6CE9B

Warm Ivory:
#F8F5EF

Cream:
#F2ECE2

Warm White:
#FCFBF8

White:
#FFFFFF

Primary Text:
#102D2A

Secondary Text:
#61706D

Border:
#E5E6E1

Muted Surface:
#F4F5F2

Gold must remain an accent.

Primary interaction color:
forest/teal.

## LOGO

Use the current approved NesAfric branding.

Ensure correct treatment for:

- desktop header
- mobile header
- dashboard sidebar
- login/register
- footer
- favicon/icon where applicable

## PUBLIC WEBSITE

The public site must follow the UPPER part of:

design/reference/nesafric-approved-reference.png

### Header

Left:
NesAfric logo

Navigation:
Home
Product
Solutions
Marketplace
Pricing
Resources

Right:
Search
Sign In
Get Started

Use existing routes only.

### Hero

Headline:

Real Estate
OS for Africa

Supporting text:

Manage properties. Connect people. Grow opportunities.
All in one intelligent platform.

Primary CTA:
Get Started

Secondary CTA:
Explore Properties

Right side:
premium modern African real-estate imagery.

Use real marketplace data for property overlays where available.

Never fabricate Production listing data.

### Trust / stats

Do not copy fake values from the concept image.

Only use real data.

If reliable stats do not exist, use non-numeric trust statements.

### Capability strip

Use actual NesAfric capabilities:

Property Management
Tenant & Lease Management
Payments & Collections
Maintenance & Work Orders
Property Marketplace
Service Professionals
Insights & Reports

Use cream/gold icon tiles.

### Why NesAfric

Section heading:

WHY NESAFRIC

Headline:

More than a marketplace.
A complete real estate operating system.

Explain the real platform capabilities.

Use dashboard/mobile product visuals on the right.

### Built for Africa

Dark forest section.

Heading:

BUILT FOR AFRICA

Headline:

Powering real estate growth across Africa

Possible supporting statement:

Local insights.
Global standards.
Built for our markets, opportunities and future.

Possible right-side statement:

One Africa
Many Opportunities

## DASHBOARD

The authenticated dashboard must follow the LOWER part of:

design/reference/nesafric-approved-reference.png

This is critical.

### Desktop structure

LEFT:
permanent sidebar

RIGHT:
main content

Do not keep a top-only dashboard navigation.

### Sidebar

Width:
approximately 240–270px

Background:
deep forest

Top:
NesAfric logo

Style:
white text
teal active state
simple line icons
subtle gold premium accents

Possible links:

Dashboard
Properties
Tenants
Leases
Payments
Maintenance
Marketplace
Professionals
Messages
Reports
AI / AI Workforce
Settings

IMPORTANT:

Do not expose all links to all users.

Preserve actual:

RBAC
workspace
role
plan
entitlements
feature gates

Platform Admin must remain separate.

### Mobile sidebar

Use accessible drawer navigation.

### Dashboard topbar

Warm white/light ivory background.

Possible contents:

search
notifications
workspace/business
avatar
name
role
date filters

Preserve actual existing functionality.

### Dashboard greeting

Property owner example:

Good morning, [actual user]

Here’s what’s happening with your properties today.

Adapt greeting to role.

### Metric cards

Examples for property owners:

Properties
Active Tenants
Rent / Revenue
Maintenance

Use real data only.

### Dashboard grid

Examples:

Property Overview
Recent Activity
Monthly Revenue
Rent Collection
Occupancy
Maintenance
Lease Expiry
Payment Status
Lead Activity
Enquiries

Only display meaningful real data.

## ROLE-AWARE DASHBOARDS

### Property Owner / Landlord

Properties
Tenants
Leases
Rent
Payments
Maintenance
Reports
Messages
AI where entitled

### Property Manager

Portfolios
Properties
Units
Tenants
Leases
Payments
Maintenance
Team
Reports

### Agent / Broker

Listings
Leads
Enquiries
Viewings
Applications
CRM
Marketplace
Messages
Reports
AI Sales where entitled

### Developer

Developments
Units
Availability
Listings
Leads
Viewings
Applications
Pipeline
Reports

### Service Professional

Profile
Services
Verification
Requests
Quotes
Assignments
Jobs
Ratings
Messages
Reports

### Tenant

Lease
Payments
Maintenance Requests
Messages
Documents
Notifications

Do not invent functionality.

## PROPERTY MANAGEMENT UI

Restyle:

properties
buildings
units
tenants
leases
payments
deposits
maintenance
rent schedules

Use:

clean page headers
search
filters
tables/cards
status badges
polished empty states

## MARKETPLACE

Use the same NesAfric visual system.

Property cards:

large photography
rent/sale badge
title
location
price
beds
baths
size
verified indicator only when real

## PROPERTY DETAIL

Use premium layout:

gallery
title
price
location
details
amenities
professional info
verification
enquiry CTA
related listings

## PROFESSIONALS

Redesign:

agents
brokers
brokerages
developers
real-estate companies

## SERVICE PROFESSIONALS

Use:

category
verification
service areas
ratings/history
request service
qualifications/jobs

Do not expose private documents.

## AUTH

Restyle:

login
register

Use:

ivory
forest
teal
minimal gold

## ONBOARDING

Restyle all onboarding flows.

Use consistent:

step progress
forest headings
teal active steps
white content cards
gold accents

## COMPONENT SYSTEM

Prefer reusable components:

Button
Card
MetricCard
PropertyCard
Input
Select
Badge
Table
Tabs
Dialog
Drawer
Sidebar
Topbar
EmptyState
Skeleton
PageHeader
FilterBar

## VISUAL STYLE RULES

Avoid:

- purple gradients
- glowing AI blobs
- glassmorphism
- generic startup blue
- excessive rounded pills
- massive shadows
- fake testimonials
- fake metrics
- unnecessary animation

Use:

- generous spacing
- refined cards
- strong hierarchy
- real-estate imagery
- subtle animation
- warm surfaces
- forest/teal/gold palette

## RESPONSIVE

Test:

1440
1280
1024
768
430
390
375

Desktop:
permanent sidebar

Tablet:
collapsible sidebar/drawer

Mobile:
drawer navigation

No horizontal overflow.

## ACCESSIBILITY

Maintain:

WCAG AA where practical
keyboard navigation
visible focus
semantic headings
accessible forms
screen reader support
reduced motion

## PERFORMANCE

Optimize:

images
fonts
bundle size
charts
animations
client boundaries

Avoid unnecessary dependencies.

## SEO

Preserve:

metadata
canonical URLs
structured data
robots
sitemap
SSR
heading hierarchy
internal links

## NO FAKE PRODUCTION DATA

Never create fake:

properties
users
tenants
leases
payments
providers
reviews
ratings
revenue
statistics
testimonials

Use empty states.

## IMPLEMENTATION ORDER

1. Audit existing app
2. Create design tokens
3. Update global typography/components
4. Redesign public header/footer
5. Redesign homepage from upper reference
6. Build dashboard shell from lower reference
7. Build role-aware dashboard homes
8. Restyle property-management pages
9. Restyle marketplace/professionals/providers
10. Restyle auth/onboarding
11. Responsive QA
12. Accessibility/performance refinement

## QUALITY GATES

Run:

tests
typecheck
lint
production build

Do not weaken tests.

## GIT

Current branch should be:

design/nesafric-reference-redesign

Do not merge to main.

Do not deploy Production.

When ready:

commit changes
push feature branch
create Preview deployment only

## FINAL ACCEPTANCE

Compare the rendered app against:

design/reference/nesafric-approved-reference.png

Confirm:

YES — homepage follows upper reference

YES — dashboard follows lower reference

YES — desktop sidebar exists

YES — forest/teal/gold palette matches

YES — warm ivory/white surfaces

YES — role-aware nav preserved

YES — dashboard data is real

YES — marketplace follows same design

YES — mobile works

YES — old visual system is removed

YES — Production unchanged

## FINAL REPORT

Return:

# NESAFRIC COMPLETE UI REDESIGN REPORT

Reference used
Baseline SHA
Branch
Final SHA
Files changed
Design tokens
Homepage
Dashboard
Sidebar
Role-aware behavior
Properties
Tenants
Leases
Payments
Maintenance
Marketplace
Professionals
Service providers
Auth
Onboarding
Mobile
Accessibility
Performance
SEO
Tests
Typecheck
Lint
Build
Preview URL
Remaining issues

Explicitly confirm:

REFERENCE IMAGE USED: YES/NO
TOP HALF USED FOR WEBSITE: YES/NO
BOTTOM HALF USED FOR DASHBOARD: YES/NO
LEFT SIDEBAR IMPLEMENTED: YES/NO
RBAC PRESERVED: YES/NO
DATABASE CHANGED: NO
PRODUCTION CHANGED: NO
PREVIEW READY: YES/NO

STOP after Preview.
Do not merge or deploy Production.
