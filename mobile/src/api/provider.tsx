import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createApiClient, type ApiClient } from "./client";

type ApiContextValue = { api: ApiClient; apiUrl: string };

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const value = useMemo(() => ({ api: createApiClient({ baseUrl: apiUrl }), apiUrl }), [apiUrl]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const context = useContext(ApiContext);
  if (!context) throw new Error("useApi must be used inside <ApiProvider>.");
  return context;
}
