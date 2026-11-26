import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, type TextInputProps, View } from "react-native";
import { configSettings } from "../shared/config";
import { type Lang, resolveLang, type Translate, translator } from "./i18n";

type Colors = PluginTheme["colors"];

interface Kit {
  colors: Colors;
  compact: boolean;
  lang: Lang;
  t: Translate;
}

const KitContext = createContext<Kit | null>(null);

// Host modals render as bottom sheets on mobile and mount their content in a separate React
// root, where this context is absent. Sheet re-provides it; this is a last-resort fallback.
let lastKit: Kit | null = null;

export function KitProvider({
  theme,
  compact,
  children,
}: {
  theme: PluginTheme;
  compact: boolean;
  children: ReactNode;
}) {
  const settings = useSettings(configSettings);
  const lang = resolveLang(settings.status === "ready" ? settings.values.language : undefined);
  const value = useMemo(
    () => ({ colors: theme.colors, compact, lang, t: translator(lang) }),
    [theme, compact, lang],
  );
  lastKit = value;
  return <KitContext.Provider value={value}>{children}</KitContext.Provider>;
}

export function useKit(): Kit {
  const kit = useContext(KitContext) ?? lastKit;
  if (!kit) throw new Error("KitProvider is missing");
  return kit;
}

/** Host Modal (dialog on wide layouts, bottom sheet on compact) with the kit re-provided inside. */
export function Sheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const kit = useKit();
  return (
    <Modal title={title} open={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content>
        <KitContext.Provider value={kit}>{children}</KitContext.Provider>
      </Modal.Content>
    </Modal>
  );
}

export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
});

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * A translucent fill that works with any theme color format. It sits below its siblings: on web an
 * absolutely positioned layer would otherwise paint over in-flow content such as icons.
 */
export function Wash({ color, opacity }: { color: string; opacity: number }) {
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity, zIndex: -1, pointerEvents: "none" }]}
    />
  );
}

type Tone = "default" | "primary" | "danger";

export function Button({
  label,
  icon,
  tone = "default",
  disabled,
  onPress,
}: {
  label: string;
  icon?: string;
  tone?: Tone;
  disabled?: boolean;
  onPress(): void;
}) {
  const { colors } = useKit();
  const primary = tone === "primary";
  const fg = primary
    ? colors.accentForeground
    : tone === "danger"
      ? colors.statusDanger
      : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: primary ? colors.accent : colors.border,
        backgroundColor: primary ? colors.accent : pressed ? colors.surface2 : colors.surface1,
        opacity: disabled ? 0.5 : pressed && primary ? 0.85 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 13, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  disabled,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  color?: string;
  onPress(): void;
}) {
  const { colors } = useKit();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.surface2 : "transparent",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Icon name={icon} size={16} color={color ?? colors.foregroundMuted} />
    </Pressable>
  );
}

export function Checkbox({
  checked,
  mixed,
  label,
  onPress,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onPress(): void;
}) {
  const { colors } = useKit();
  const on = checked || mixed;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: mixed ? "mixed" : checked }}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: on ? colors.accent : colors.foregroundMuted,
        backgroundColor: on ? colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on ? (
        <Icon name={mixed ? "Minus" : "Check"} size={12} color={colors.accentForeground} />
      ) : null}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress(): void;
}) {
  const { colors } = useKit();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 26,
        paddingHorizontal: 9,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.surface2 : "transparent",
      }}
    >
      {active ? <Icon name="Check" size={12} color={colors.accent} /> : null}
      <Text
        style={{ color: active ? colors.foreground : colors.foregroundMuted, fontSize: 12 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Banner({
  tone,
  icon,
  text,
  action,
}: {
  tone: "warning" | "danger";
  icon: string;
  text: string;
  action?: ReactNode;
}) {
  const { colors } = useKit();
  const color = tone === "danger" ? colors.statusDanger : colors.statusWarning;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 36,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: color,
        overflow: "hidden",
      }}
    >
      <Wash color={color} opacity={0.08} />
      <Icon name={icon} size={15} color={color} />
      <Text style={{ flex: 1, color: colors.foreground, fontSize: 13 }}>{text}</Text>
      {action}
    </View>
  );
}

export function Field(props: TextInputProps) {
  const { colors } = useKit();
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={colors.foregroundMuted}
      {...props}
      style={[
        {
          // Android keeps default vertical padding inside a fixed height and clips glyph tops.
          height: 38,
          paddingVertical: 0,
          textAlignVertical: "center",
          paddingHorizontal: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface2,
          color: colors.foreground,
          fontSize: 14,
        },
        props.style,
      ]}
    />
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  const { colors } = useKit();
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}
    >
      <Icon name={icon} size={28} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{title}</Text>
      <Text
        style={{ color: colors.foregroundMuted, fontSize: 13, textAlign: "center", maxWidth: 420 }}
      >
        {text}
      </Text>
      {action ? <View style={{ marginTop: 6 }}>{action}</View> : null}
    </View>
  );
}
