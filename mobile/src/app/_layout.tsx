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

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

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
                <Stack.Screen name="workspace/[organisationId]/index" options={{ headerShown: true, title: "Workspace", headerBackTitle: "Account" }} />
                <Stack.Screen name="workspace/[organisationId]/inbox" options={{ headerShown: true, title: "Enquiries & viewings", headerBackTitle: "Workspace" }} />
                <Stack.Screen name="workspace/[organisationId]/enquiry/[leadId]" options={{ headerShown: true, title: "Enquiry", headerBackTitle: "Inbox" }} />
                <Stack.Screen name="workspace/[organisationId]/viewing/[viewingId]" options={{ headerShown: true, title: "Viewing request", headerBackTitle: "Inbox" }} />
                <Stack.Screen name="agent/[professionalId]/index" options={{ headerShown: true, title: "Agent workspace", headerBackTitle: "Account" }} />
                <Stack.Screen name="agent/[professionalId]/inbox" options={{ headerShown: true, title: "Enquiries & viewings", headerBackTitle: "Workspace" }} />
                <Stack.Screen name="agent/[professionalId]/enquiry/[leadId]" options={{ headerShown: true, title: "Enquiry", headerBackTitle: "Inbox" }} />
                <Stack.Screen name="agent/[professionalId]/viewing/[viewingId]" options={{ headerShown: true, title: "Viewing request", headerBackTitle: "Inbox" }} />
                <Stack.Screen name="home/[tenancyId]/index" options={{ headerShown: true, title: "Your home", headerBackTitle: "Account" }} />
                <Stack.Screen name="home/[tenancyId]/report" options={{ headerShown: true, presentation: "modal", title: "Report a problem" }} />
                <Stack.Screen name="home/[tenancyId]/request/[requestId]" options={{ headerShown: true, title: "Repair request", headerBackTitle: "Home" }} />
              </Stack>
            </SavedProvider>
            </SessionProvider>
          </ApiProvider>
        </QueryClientProvider>
      )}
    </SafeAreaProvider>
  );
}
