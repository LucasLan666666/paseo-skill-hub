import type { PluginScreenProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { MessageKey } from "./i18n";
import { KitProvider, useKit } from "./kit";
import { SettingsPage } from "./SettingsPage";
import { SkillsPage } from "./SkillsPage";

type Tab = "skills" | "settings";

const TABS: { id: Tab; label: MessageKey; icon: string }[] = [
  { id: "skills", label: "tab.skills", icon: "Blocks" },
  { id: "settings", label: "tab.settings", icon: "Settings" },
];

export function HubScreen({ theme, layout, params }: PluginScreenProps) {
  const [tab, setTab] = useState<Tab>(params.tab === "settings" ? "settings" : "skills");
  const pad = layout.compact ? 12 : 20;
  return (
    <KitProvider theme={theme} compact={layout.compact}>
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: pad, gap: 12 }}>
        <Tabs value={tab} onChange={setTab} />
        {tab === "skills" ? (
          <SkillsPage onOpenSettings={() => setTab("settings")} />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: pad }}>
            <View style={{ width: "100%", maxWidth: 760, alignSelf: "center" }}>
              <SettingsPage />
            </View>
          </ScrollView>
        )}
      </View>
    </KitProvider>
  );
}

/** The same settings page, under Settings → Plugins → Skill Hub. */
export function HubSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  return (
    <KitProvider theme={theme} compact={layout.compact}>
      <SettingsPage />
    </KitProvider>
  );
}

function Tabs({ value, onChange }: { value: Tab; onChange(tab: Tab): void }) {
  const { colors, t } = useKit();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        alignSelf: "flex-start",
        padding: 2,
        gap: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      }}
    >
      {TABS.map((tab) => {
        const active = tab.id === value;
        const color = active ? colors.foreground : colors.foregroundMuted;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: 28,
              paddingHorizontal: 12,
              borderRadius: 6,
              backgroundColor: active ? colors.surface2 : "transparent",
            }}
          >
            <Icon name={tab.icon} size={14} color={color} />
            <Text style={{ color, fontSize: 13, fontWeight: active ? "600" : "500" }}>
              {t(tab.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
