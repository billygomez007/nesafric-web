import type { FlowKey } from "../registry";
import {
  body, caption, complete, datePicker, dropdown, flowJson, formPayload, heading, options, PURPOSE_OPTIONS, radios, REGION_OPTIONS,
  screen, str, submit, subheading, textArea, textInput, type Option,
} from "./components";

/**
 * Flow JSON for the twelve NesAfric Flows. Screens only lay out what the endpoint sends: every
 * list (properties, slots, businesses, tenancies, providers) is server data, and every submission
 * goes back to the endpoint, which validates it again before anything is written.
 */
const OPT: Option[] = [{ id: "1", title: "Example" }];
const DONE = screen({ id: "DONE", title: "NesAfric", terminal: true, data: { message: str("Thank you. We will continue in the chat.") }, children: [body("${data.message}"), complete("Close")] });
const BEDROOMS: Option[] = [{ id: "1", title: "1 bedroom" }, { id: "2", title: "2 bedrooms" }, { id: "3", title: "3 bedrooms" }, { id: "4", title: "4 bedrooms" }, { id: "5", title: "5 or more" }];

function propertySearch() {
  const search = [
    radios("purpose", "Rent or buy?", PURPOSE_OPTIONS),
    dropdown("category", "Property type", "${data.categories}", { required: false }),
    dropdown("region", "Region", "${data.regions}"),
    textInput("area", "Town or area (optional)", { required: false, "max-chars": 80, "helper-text": "For example East Legon, Kasoa or Adum" }),
    textInput("max_budget", "Maximum budget in GHS (optional)", { required: false, "input-type": "number", "helper-text": "Per month for rentals" }),
    dropdown("bedrooms", "Bedrooms (optional)", BEDROOMS, { required: false }),
  ];
  return flowJson([
    screen({ id: "SEARCH", title: "Find a property", data: { categories: options(OPT), regions: options(REGION_OPTIONS.slice(0, 2)) }, children: [heading("Find a property in Ghana"), ...search, submit("Search", "search", formPayload(search))] }),
    screen({ id: "RESULTS", title: "Matching properties", data: { summary: str("3 properties match your search."), results: options([{ id: "listing-id", title: "2-bedroom apartment, East Legon", description: "GHS 4,500 / month" }]), filters: str("{}") }, children: [
      body("${data.summary}"), radios("listing", "Choose a property", "${data.results}"),
      submit("View property", "select", { listing: "${form.listing}", filters: "${data.filters}" }),
    ] }),
    screen({ id: "DETAILS", title: "Property details", data: {
      listing_id: str("listing-id"), title: str("2-bedroom apartment, East Legon"), price: str("GHS 4,500 / month"), location: str("East Legon, Greater Accra"),
      features: str("2 bedrooms · 2 bathrooms"), description: str("Bright apartment close to the main road."), next_steps: options([{ id: "book", title: "Book a viewing" }]),
    }, children: [
      heading("${data.title}"), subheading("${data.price}"), body("${data.location}"), body("${data.features}"), body("${data.description}"),
      radios("next", "What would you like to do?", "${data.next_steps}"),
      submit("Continue", "next", { listing: "${data.listing_id}", next: "${form.next}" }),
    ] }),
    DONE,
  ], { SEARCH: ["RESULTS"], RESULTS: ["DETAILS"], DETAILS: ["DONE"], DONE: [] });
}

function bookViewing() {
  const form = [
    datePicker("date", "Preferred date", { "min-date": "${data.min_date}", "max-date": "${data.max_date}", "on-select-action": { name: "data_exchange", payload: { action: "date", date: "${form.date}" } } }),
    dropdown("slot", "Preferred time (Ghana time)", "${data.slots}"),
    textInput("name", "Your name", { "init-value": "${data.name}", "min-chars": 2, "max-chars": 100 }),
    textArea("note", "Anything the agent should know? (optional)", { required: false, "max-length": 500 }),
  ];
  return flowJson([
    screen({ id: "BOOK", title: "Book a viewing", data: { property: str("2-bedroom apartment, East Legon"), min_date: str("2026-10-26"), max_date: str("2026-12-24"), slots: options([{ id: "10:00", title: "10:00 am" }]), name: str("Ama") }, children: [
      heading("${data.property}"), ...form, caption("This requests a one-hour viewing. The agent confirms the time with you."),
      submit("Request viewing", "book", formPayload(form)),
    ] }),
    DONE,
  ], { BOOK: ["DONE"], DONE: [] });
}

function propertyInquiry() {
  const form = [
    textInput("name", "Your name", { "init-value": "${data.name}", "min-chars": 2, "max-chars": 100 }),
    textArea("message", "Your question", { "max-length": 2000, "helper-text": "For example: Is it still available? Is the rent negotiable?" }),
  ];
  return flowJson([
    screen({ id: "INQUIRY", title: "Ask about a property", data: { property: str("2-bedroom apartment, East Legon"), name: str("Ama") }, children: [
      heading("${data.property}"), ...form, caption("Your name and WhatsApp number are shared with the listing team only."), submit("Send question", "send", formPayload(form)),
    ] }),
    DONE,
  ], { INQUIRY: ["DONE"], DONE: [] });
}

function listProperty() {
  const basics = [
    dropdown("business", "Listing for", "${data.businesses}"),
    dropdown("property", "Which of your properties? (landlords)", "${data.properties}", { required: false }),
    radios("purpose", "For rent or for sale?", [{ id: "RENT", title: "For rent" }, { id: "SALE", title: "For sale" }]),
    dropdown("category", "Property type", "${data.categories}"),
    textInput("title", "Listing title", { "min-chars": 5, "max-chars": 120, "helper-text": "For example: 3-bedroom house with garden in Spintex" }),
    dropdown("region", "Region", "${data.regions}"),
    textInput("city", "Town or district", { "min-chars": 2, "max-chars": 100 }),
    textInput("locality", "Neighbourhood (optional)", { required: false, "max-chars": 100 }),
  ];
  const pricing = [
    textInput("price", "Price in GHS", { "input-type": "number" }),
    dropdown("price_unit", "Rent period or price unit", "${data.units}", { required: false }),
    textInput("bedrooms", "Bedrooms (homes)", { required: false, "input-type": "number" }),
    textInput("bathrooms", "Bathrooms (homes)", { required: false, "input-type": "number" }),
    dropdown("furnishing", "Furnishing (homes, optional)", "${data.furnishing_options}", { required: false }),
    textInput("size", "Floor area in m² (commercial, optional)", { required: false, "input-type": "number" }),
    textInput("land_size", "Land size in m² (land)", { required: false, "input-type": "number" }),
    { type: "CheckboxGroup", name: "amenities", label: "Amenities (optional)", required: false, "data-source": "${data.amenity_options}" },
    textArea("description", "Description", { "max-length": 2000, "helper-text": "Layout, condition and what is nearby; at least 20 characters" }),
  ];
  const authority = [
    dropdown("authority", "Your authority to list it", "${data.authorities}"),
    dropdown("evidence_type", "Document that proves it", "${data.evidence_types}"),
    textInput("evidence_reference", "Document reference", { "min-chars": 3, "max-chars": 200, "helper-text": "For example the mandate date and owner's name, or the title number" }),
  ];
  const carried = (names: string[]) => Object.fromEntries(names.map((name) => [name, `\${data.${name}}`]));
  const basicNames = basics.map((item) => item.name as string);
  const pricingNames = pricing.map((item) => item.name as string);
  const asData = (names: string[]) => Object.fromEntries(names.map((name) => [name, str("")]));
  return flowJson([
    screen({ id: "BASICS", title: "List a property", data: { businesses: options(OPT), properties: options(OPT), categories: options(OPT), regions: options(REGION_OPTIONS.slice(0, 2)) }, children: [heading("Property basics"), ...basics, submit("Next", "basics", formPayload(basics))] }),
    screen({ id: "NOTICE", title: "NesAfric", terminal: true, data: { message: str("Connect this number to your NesAfric account first: reply link in the chat.") }, children: [body("${data.message}"), complete("Close")] }),
    screen({ id: "PRICING", title: "Price and details", data: { units: options(OPT), furnishing_options: options(OPT), amenity_options: options(OPT), ...asData(basicNames) }, children: [heading("Price and details"), ...pricing, submit("Next", "pricing", { ...formPayload(pricing), ...carried(basicNames) })] }),
    screen({ id: "AUTHORITY", title: "Authority to list", data: { authorities: options(OPT), evidence_types: options(OPT), ...asData([...basicNames, ...pricingNames]) }, children: [
      heading("Your authority to list"), body("NesAfric reviews every listing before it is published. Photos come next, in the chat."), ...authority,
      submit("Save and add photos", "save", { ...formPayload(authority), ...carried([...basicNames, ...pricingNames]) }),
    ] }),
    DONE,
  ], { BASICS: ["PRICING", "NOTICE"], NOTICE: [], PRICING: ["AUTHORITY"], AUTHORITY: ["DONE"], DONE: [] });
}

function agentRegistration() {
  const form = [
    radios("kind", "What are you registering?", "${data.kinds}"),
    textInput("name", "Name clients will see", { "min-chars": 2, "max-chars": 200 }),
    textInput("legal_name", "Registered (legal) name, companies (optional)", { required: false, "max-chars": 300 }),
    textInput("email", "Business email (optional)", { required: false, "input-type": "email" }),
    dropdown("region", "Region", "${data.regions}"),
    textInput("city", "Town or area", { "min-chars": 2, "max-chars": 150 }),
    textInput("areas", "Areas you cover", { "max-chars": 400, "helper-text": "Separate with commas: East Legon, Cantonments, Tema" }),
    textArea("description", "About the business", { "max-length": 2000, "helper-text": "At least 20 characters" }),
    textInput("reference", "Registration, GREDA or licence number (optional for agents)", { required: false, "max-chars": 300 }),
  ];
  return flowJson([
    screen({ id: "PROFILE", title: "Register on NesAfric", data: { kinds: options(OPT), regions: options(REGION_OPTIONS.slice(0, 2)) }, children: [
      heading("Agency or agent registration"), ...form,
      caption("Next, in the chat: agencies send the business registration certificate; agents send the front and back of their Ghana Card."),
      submit("Continue", "save", formPayload(form)),
    ] }),
    screen({ id: "NOTICE", title: "NesAfric", terminal: true, data: { message: str("Connect this number to your NesAfric account first: reply link in the chat.") }, children: [body("${data.message}"), complete("Close")] }),
    DONE,
  ], { PROFILE: ["DONE", "NOTICE"], NOTICE: [], DONE: [] });
}

function landlordRegistration() {
  const form = [
    radios("role", "You are", [{ id: "LANDLORD", title: "A landlord (I own the property)" }, { id: "MANAGER", title: "A property manager" }]),
    textInput("organisation", "Name to manage the properties under", { "min-chars": 2, "max-chars": 160, "helper-text": "For example: Owusu Homes" }),
    textInput("property", "First property name", { "min-chars": 2, "max-chars": 200 }),
    textInput("city", "Town or area", { "min-chars": 2, "max-chars": 100 }),
    textInput("address", "Address (optional)", { required: false, "max-chars": 250 }),
    textInput("units", "Units", { "max-chars": 400, "helper-text": "A number (4) or names separated by commas (A1, A2, A3)" }),
  ];
  return flowJson([
    screen({ id: "SETUP", title: "Landlord sign-up", data: {}, children: [heading("Set up your properties"), ...form, caption("You can add more properties, units and your tenants next, in the chat."), submit("Continue", "save", formPayload(form))] }),
    screen({ id: "NOTICE", title: "NesAfric", terminal: true, data: { message: str("Reply register in the chat to create your account first.") }, children: [body("${data.message}"), complete("Close")] }),
    DONE,
  ], { SETUP: ["DONE", "NOTICE"], NOTICE: [], DONE: [] });
}

function tenantRegistration() {
  const form = [textInput("code", "Tenant access code from your landlord", { "min-chars": 6, "max-chars": 40, "helper-text": "It starts with NT-" })];
  return flowJson([
    screen({ id: "CONNECT", title: "Connect your tenancy", data: {}, children: [heading("Connect your tenancy"), body("Your landlord gives you an access code when they add you on NesAfric."), ...form, submit("Connect", "redeem", formPayload(form))] }),
    screen({ id: "NOTICE", title: "NesAfric", terminal: true, data: { message: str("Reply link in the chat to confirm this number first.") }, children: [body("${data.message}"), complete("Close")] }),
    DONE,
  ], { CONNECT: ["DONE", "NOTICE"], NOTICE: [], DONE: [] });
}

function maintenanceRequest() {
  const form = [
    dropdown("tenancy", "Property", "${data.tenancies}"),
    dropdown("category", "Type of problem", "${data.categories}"),
    textInput("title", "Short title", { "min-chars": 3, "max-chars": 120, "helper-text": "For example: Kitchen sink leaking" }),
    textArea("description", "What is wrong?", { "max-length": 2000 }),
    radios("priority", "How urgent is it?", [
      { id: "EMERGENCY", title: "Emergency", description: "Danger to people or property now" }, { id: "URGENT", title: "Urgent", description: "Needs attention within a day" },
      { id: "NORMAL", title: "Normal" }, { id: "LOW", title: "Low" },
    ]),
  ];
  return flowJson([
    screen({ id: "REPORT", title: "Report a problem", data: { tenancies: options(OPT), categories: options(OPT) }, children: [heading("Report a problem to your landlord"), ...form, caption("You can send photos of the problem in the chat afterwards."), submit("Send report", "report", formPayload(form))] }),
    screen({ id: "NOTICE", title: "NesAfric", terminal: true, data: { message: str("No tenancy is connected to this number yet.") }, children: [body("${data.message}"), complete("Close")] }),
    DONE,
  ], { REPORT: ["DONE", "NOTICE"], NOTICE: [], DONE: [] });
}

function findProfessional() {
  const form = [textInput("service", "Service needed", { "min-chars": 2, "max-chars": 80, "helper-text": "For example plumber, electrician, AC repair" }), textInput("area", "Town or area", { "min-chars": 2, "max-chars": 80 })];
  return flowJson([
    screen({ id: "SEARCH", title: "Find a professional", data: {}, children: [heading("Find a verified professional"), ...form, submit("Search", "search", formPayload(form))] }),
    screen({ id: "RESULTS", title: "Verified professionals", data: { summary: str("2 verified providers found."), results: options([{ id: "provider-id", title: "Kofi Plumbing", description: "Plumbing · Tema" }]) }, children: [
      body("${data.summary}"), radios("provider", "Choose a provider", "${data.results}"), submit("View profile", "select", { provider: "${form.provider}" }),
    ] }),
    DONE,
  ], { SEARCH: ["RESULTS"], RESULTS: ["DONE"], DONE: [] });
}

function bookService() {
  const form = [
    dropdown("category", "Service", "${data.categories}"),
    textInput("area", "Town or area", { "min-chars": 2, "max-chars": 100 }),
    textArea("description", "Describe the job", { "max-length": 2000 }),
    datePicker("date", "Preferred date (optional)", { required: false, "min-date": "${data.min_date}", "max-date": "${data.max_date}" }),
    textInput("name", "Your name", { "init-value": "${data.name}", "min-chars": 2, "max-chars": 100 }),
  ];
  return flowJson([
    screen({ id: "REQUEST", title: "Book a service", data: { categories: options(OPT), min_date: str("2026-10-26"), max_date: str("2026-12-24"), name: str("Ama") }, children: [heading("Request a service"), ...form, caption("NesAfric matches your request with verified providers and replies in the chat."), submit("Send request", "request", formPayload(form))] }),
    DONE,
  ], { REQUEST: ["DONE"], DONE: [] });
}

function propertyManagement() {
  return flowJson([
    screen({ id: "MENU", title: "Property management", data: { summary: str("Owusu Homes: 2 properties, 5 units, 3 tenants."), actions: options(OPT) }, children: [
      heading("Your properties"), body("${data.summary}"), radios("task", "What would you like to do?", "${data.actions}"), submit("Continue", "choose", { task: "${form.task}" }),
    ] }),
    screen({ id: "NOTICE", title: "NesAfric", terminal: true, data: { message: str("Reply register in the chat to set up your properties first.") }, children: [body("${data.message}"), complete("Close")] }),
    DONE,
  ], { MENU: ["DONE", "NOTICE"], NOTICE: [], DONE: [] });
}

function helpSupport() {
  const form = [
    radios("topic", "What do you need help with?", [
      { id: "ACCOUNT", title: "My account or sign-in" }, { id: "LISTING", title: "A listing or viewing" }, { id: "TENANCY", title: "My tenancy or a repair" },
      { id: "PAYMENT", title: "Payments or subscription" }, { id: "OTHER", title: "Something else" },
    ]),
    textArea("message", "Tell us more", { "max-length": 2000 }),
  ];
  return flowJson([
    screen({ id: "HELP", title: "Help and support", data: {}, children: [heading("How can we help?"), ...form, caption("A member of the NesAfric team replies in this chat."), submit("Send to support", "send", formPayload(form))] }),
    DONE,
  ], { HELP: ["DONE"], DONE: [] });
}

export const FLOW_DEFINITIONS: Record<FlowKey, () => Record<string, unknown>> = {
  nesafric_property_search: propertySearch,
  nesafric_book_viewing: bookViewing,
  nesafric_property_inquiry: propertyInquiry,
  nesafric_list_property: listProperty,
  nesafric_agent_registration: agentRegistration,
  nesafric_landlord_registration: landlordRegistration,
  nesafric_tenant_registration: tenantRegistration,
  nesafric_maintenance_request: maintenanceRequest,
  nesafric_find_professional: findProfessional,
  nesafric_book_service: bookService,
  nesafric_property_management: propertyManagement,
  nesafric_help_support: helpSupport,
};


