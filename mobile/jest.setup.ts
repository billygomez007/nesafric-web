/// <reference types="jest" />
import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

// The app refuses to start without an API origin; tests use a fake one with a mocked fetch.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

// expo-crypto is a native module; in Jest use Node's real UUID generator.
jest.mock("expo-crypto", () => {
  const crypto = jest.requireActual<typeof import("crypto")>("crypto");
  return {
    randomUUID: () => crypto.randomUUID(),
    getRandomBytes: (count: number) => new Uint8Array(crypto.randomBytes(count)),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { HEX: "hex", BASE64: "base64" },
    digestStringAsync: async (_algorithm: string, data: string, options?: { encoding?: "hex" | "base64" }) =>
      crypto.createHash("sha256").update(data).digest(options?.encoding ?? "hex"),
  };
});

// expo-secure-store is native (Keychain / Keystore). In Jest, an in-memory stand-in that records
// calls, so tests can assert what is (and isn't) written to secure storage.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

// expo-image-picker opens the native photo library. In Jest, a stub that tests configure with the
// photos the "user" picks (`launchImageLibraryAsync.mockResolvedValueOnce(...)`).
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })) }));
