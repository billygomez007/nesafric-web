import { z } from "zod";

/** An absolute http(s) URL. `z.string().url()` alone also accepts `javascript:` and `data:` URLs,
 * which become script execution the moment such a value is rendered as a link. Use this for every
 * user-supplied URL that may be shown or followed. */
export const safeHttpUrl = (max: number) =>
  z.string().trim().max(max).refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Must be an absolute http:// or https:// URL");
