import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { ApiProvider } from "@/api/provider";
import { SessionProvider } from "@/auth/session";
import { StateMessage } from "@/components/ui";
import { ConfigError, loadConfig, type AppConfig } from "@/config";
import { SavedProvider } from "@/marketplace/saved";
import { hideSplashOnce, WorkspaceNavigator } from "@/workspace/navigator";
import { colors, fonts } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync();

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // Retry transient failures on weak networks, never 4xx (validation, not found).
        retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
      },
    },
  });
}

function readConfig(): { config: AppConfig } | { error: string } {
  try {
    return { config: loadConfig() };
  } catch (error) {
    return { error: error instanceof ConfigError ? error.message : "Invalid app configuration." };
  }
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [fonts.regular]: require("../../assets/fonts/NotoSans-Regular.ttf"),
    [fonts.bold]: require("../../assets/fonts/NotoSans-Bold.ttf"),
  });
  const [queryClient] = useState(createQueryClient);
  const [configResult] = useState(readConfig);
  const ready = fontsLoaded || Boolean(fontError);

  // With a valid config the splash is hidden by WorkspaceNavigator, once it knows whether a
  // returning user resumes a workspace (bounded wait). Otherwise hide it as soon as we can render.
  useEffect(() => {
    if (ready && "error" in configResult) hideSplashOnce();
  }, [ready, configResult]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {"error" in configResult ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <StateMessage title="App not configured" message={configResult.error} />
        </SafeAreaView>
      ) : (
        <QueryClientProvider client={queryClient}>
          <ApiProvider apiUrl={configResult.config.apiUrl}>
            {/* Sign-in is optional: the marketplace renders immediately, never gated on the session. */}
            <SessionProvider apiUrl={configResult.config.apiUrl}>
            <SavedProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                  headerTintColor: colors.ink,
                  headerTitleStyle: { fontFamily: fonts.bold },
                  headerStyle: { backgroundColor: colors.background },
                  headerShadowVisible: false,
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="listing/[id]/index" options={{ headerShown: true, title: "", headerBackTitle: "Back" }} />
                <Stack.Screen name="listing/[id]/enquire" options={{ headerShown: true, presentation: "modal", title: "Contact" }} />
                <Stack.Screen name="sign-in" options={{ headerShown: true, presentation: "modal", title: "Sign in" }} />
                {/* Workspaces bring their own tabs and headers; each is gated on the server's workspace list. */}
                <Stack.Screen name="workspace/[organisationId]" />
                <Stack.Screen name="agent/[professionalId]" />
                <Stack.Screen name="provider/[providerId]" />
                <Stack.Screen name="switch-workspace" options={{ headerShown: true, presentation: "modal", title: "Switch workspace" }} />
                <Stack.Screen name="setup/[kind]" options={{ headerShown: true, title: "", headerBackTitle: "Back" }} />
                <Stack.Screen name="home/[tenancyId]/index" options={{ headerShown: true, title: "Your home", headerBackTitle: "Account" }} />
                <Stack.Screen name="home/[tenancyId]/report" options={{ headerShown: true, presentation: "modal", title: "Report a problem" }} />
                <Stack.Screen name="home/[tenancyId]/request/[requestId]" options={{ headerShown: true, title: "Repair request", headerBackTitle: "Home" }} />
              </Stack>
              <WorkspaceNavigator />
            </SavedProvider>
            </SessionProvider>
          </ApiProvider>
        </QueryClientProvider>
      )}
    </SafeAreaProvider>
  );
}
