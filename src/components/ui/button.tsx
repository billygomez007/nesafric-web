import type { ButtonHTMLAttributes } from "react";
import { buttonStyles, type ButtonVariant } from "./button-styles";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

/** Real `<button>` element using the shared UmoAfric button system. For a styled `<Link>`
 * (navigation, not form submission), use `buttonStyles[variant]` directly as the className. */
export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return <button className={`${buttonStyles[variant]} ${className}`} type={type} {...props} />;
}
