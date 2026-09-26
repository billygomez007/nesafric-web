import type { ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button-styles";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

/** Real `<button>` element using the shared NesAfric button system. For a styled `<Link>`
 * (navigation, not form submission), use `buttonClass(variant, size)` as the className. */
export function Button({ variant = "primary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  return <button className={`${buttonClass(variant, size)} ${className}`} type={type} {...props} />;
}
