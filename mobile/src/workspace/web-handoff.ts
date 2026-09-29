import * as WebBrowser from "expo-web-browser";
import { AppState } from "react-native";

/**
 * Opens a set-up step on nesafric.com and runs `refresh` once the person is back in the app, so a
 * workspace created there shows up without a manual refresh or signing out.
 *
 * The platforms differ: on iOS `openBrowserAsync` resolves when the browser is closed, but on
 * Android it resolves `{ type: "opened" }` straight away, before anything was created. There the
 * refresh waits for the app to come back to the foreground instead.
 */
export async function openWebsiteThenRefresh(url: string, refresh: () => void) {
  let done = false;
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") finish();
  });
  function finish() {
    if (done) return;
    done = true;
    subscription.remove();
    refresh();
  }
  try {
    const result = await WebBrowser.openBrowserAsync(url);
    if (result.type !== "opened") finish();
  } catch (error) {
    done = true;
    subscription.remove();
    throw error;
  }
}
