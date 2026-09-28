/// <reference types="jest" />
import { act, fireEvent, screen } from "@testing-library/react-native";

/** What `POST /api/auth/otp/request` answers (the same whether or not the address has an account). */
export const OTP_CHALLENGE = {
  challengeId: "5b0f7f6e-2d3c-4a4b-9a55-000000000001",
  channel: "email",
  destination: "ama@example.com",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  resendAfterSeconds: 60,
};

export const OTP_REQUEST_PATH = "/api/auth/otp/request";
export const OTP_VERIFY_PATH = "/api/auth/mobile/otp/verify";

/** Drives the sign-in screen: Email → address → Send code → 6-digit code → Verify. */
export async function signInWithEmailCode(email = "ama@example.com", code = "123456") {
  fireEvent.press(await screen.findByTestId("sign-in-method-email"));
  fireEvent.changeText(await screen.findByTestId("sign-in-email"), email);
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-send-code")));
  fireEvent.changeText(await screen.findByTestId("sign-in-code"), code);
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-verify")));
}
