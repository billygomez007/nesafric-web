import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { hashPassword } from "@/platform/auth/passwords";
import { loginSchema, registerSchema } from "./schemas";
import { verifyPassword } from "@/platform/auth/passwords";

export async function registerUser(input: unknown) {
  const data = registerSchema.parse(input);
  const email = data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new AppError("EMAIL_EXISTS", 409, "An account with this email already exists.");
  return db.user.create({ data: { email, displayName: data.displayName, passwordHash: await hashPassword(data.password) } });
}

export async function authenticateUser(input: unknown) {
  const data = loginSchema.parse(input);
  const user = await db.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!user || !(await verifyPassword(user.passwordHash, data.password))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Email or password is incorrect.");
  }
  return user;
}
