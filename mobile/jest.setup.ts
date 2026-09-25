/// <reference types="jest" />
import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

// The app refuses to start without an API origin; tests use a fake one with a mocked fetch.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

// expo-crypto is a native module; in Jest use Node's real UUID generator.
jest.mock("expo-crypto", () => ({ randomUUID: () => jest.requireActual<typeof import("crypto")>("crypto").randomUUID() }));
