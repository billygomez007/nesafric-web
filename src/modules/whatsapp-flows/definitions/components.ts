/**
 * Small builders for Meta WhatsApp Flow JSON (version below). Every NesAfric Flow is a
 * data_exchange Flow: its first screen comes from the endpoint (INIT) and every Footer sends the
 * form to the endpoint, so options, prices and availability are always NesAfric's current data.
 */
export const FLOW_JSON_VERSION = "7.1";
export const DATA_API_VERSION = "3.0";

type Json = Record<string, unknown>;
export type Option = { id: string; title: string; description?: string };
export type ScreenDef = { id: string; title: string; data?: Record<string, Json>; terminal?: boolean; children: Json[] };

export const str = (example: string): Json => ({ type: "string", __example__: example });
export const bool = (example: boolean): Json => ({ type: "boolean", __example__: example });
export const options = (example: Option[]): Json => ({
  type: "array",
  items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } } },
  __example__: example,
});

export const heading = (text: string): Json => ({ type: "TextHeading", text });
export const subheading = (text: string): Json => ({ type: "TextSubheading", text });
export const body = (text: string): Json => ({ type: "TextBody", text });
export const caption = (text: string): Json => ({ type: "TextCaption", text });
export const textInput = (name: string, label: string, extra: Json = {}): Json => ({ type: "TextInput", name, label, "input-type": "text", required: true, ...extra });
export const textArea = (name: string, label: string, extra: Json = {}): Json => ({ type: "TextArea", name, label, required: true, ...extra });
export const dropdown = (name: string, label: string, source: string | Option[], extra: Json = {}): Json => ({ type: "Dropdown", name, label, required: true, "data-source": source, ...extra });
export const radios = (name: string, label: string, source: string | Option[], extra: Json = {}): Json => ({ type: "RadioButtonsGroup", name, label, required: true, "data-source": source, ...extra });
export const datePicker = (name: string, label: string, extra: Json = {}): Json => ({ type: "DatePicker", name, label, required: true, ...extra });

/** The Footer: sends `payload` (form fields as `${form.x}`) to the endpoint with `action`. */
export const submit = (label: string, action: string, payload: Record<string, string> = {}): Json => ({
  type: "Footer", label, "on-click-action": { name: "data_exchange", payload: { action, ...payload } },
});
export const complete = (label: string, payload: Record<string, string> = {}): Json => ({
  type: "Footer", label, "on-click-action": { name: "complete", payload },
});

/** `${form.name}` references for every named input among `children`. */
export function formPayload(children: Json[]): Record<string, string> {
  return Object.fromEntries(children.filter((child) => typeof child.name === "string").map((child) => [child.name as string, `\${form.${child.name as string}}`]));
}

export function screen(def: ScreenDef): Json {
  return {
    id: def.id,
    title: def.title,
    ...(def.terminal ? { terminal: true, success: true } : {}),
    ...(def.data ? { data: def.data } : {}),
    layout: { type: "SingleColumnLayout", children: def.children },
  };
}

export function flowJson(screens: Json[], routing: Record<string, string[]>): Json {
  return { version: FLOW_JSON_VERSION, data_api_version: DATA_API_VERSION, routing_model: routing, screens };
}

/** Shared choices (Ghana): the website's property types (WhatsApp excludes hotels and short stays), regions and price units. */
export const REGION_OPTIONS: Option[] = ["Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern", "Volta", "Oti", "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo"].map((name) => ({ id: name, title: name }));
export const PURPOSE_OPTIONS: Option[] = [{ id: "RENT", title: "To rent" }, { id: "SALE", title: "To buy" }];
