import { render, screen } from "@testing-library/react-native";
import { ActivityIndicator, StyleSheet } from "react-native";

import { ListRow } from "@/components/list-row";
import { Button } from "@/components/ui";
import { colors } from "@/theme/tokens";

/** WCAG relative-luminance contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const styleOf = (testID: string) => {
  const style = screen.getByTestId(testID).props.style;
  return StyleSheet.flatten(typeof style === "function" ? style({ pressed: false }) : style) as Record<string, string>;
};

describe("button loading contrast", () => {
  it.each(["primary", "dark", "destructive"] as const)("a %s button that is loading and disabled keeps its background, so the spinner stays visible", (variant) => {
    render(<Button label="Send code" variant={variant} loading disabled onPress={() => {}} testID="button" />);
    const background = styleOf("button").backgroundColor;
    expect(background).not.toBe(colors.disabledBackground);
    const spinner = screen.UNSAFE_getByType(ActivityIndicator).props.color as string;
    expect(contrast(spinner, background)).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("button").props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it("a disabled button that is not loading still turns grey", () => {
    render(<Button label="Send code" disabled onPress={() => {}} testID="button" />);
    expect(styleOf("button").backgroundColor).toBe(colors.disabledBackground);
  });
});

describe("highlighted row contrast", () => {
  it("marks a highlighted or selected row with an edge that meets 3:1 on white", () => {
    render(<ListRow title="Kofi Plumbing" highlighted onPress={() => {}} testID="row" />);
    const edge = styleOf("row").borderLeftColor;
    expect(edge).toBe(colors.action);
    expect(contrast(edge, colors.elevated)).toBeGreaterThanOrEqual(3);
  });
});
