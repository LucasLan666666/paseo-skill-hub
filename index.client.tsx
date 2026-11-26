import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { HubScreen, HubSettingsScreen } from "./client/HubScreen";

function SkillHubItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Blocks"
      label="Skill Hub"
      active={currentScreen?.screenId === "main"}
      onPress={() => openScreen({ screenId: "main" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "main", title: "Skill Hub", Component: HubScreen });
  client.addSidebarHeaderItem({ id: "main", title: "Skill Hub", Component: SkillHubItem });
  client.addSettingsScreen({
    id: "settings",
    title: "Skill Hub",
    icon: "Blocks",
    Component: HubSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open",
    title: "Skill Hub",
    icon: "Blocks",
    context: "global",
    keywords: ["skill", "skills", "SKILL.md", "agent", "symlink", "技能"],
    onSelect({ openScreen }) {
      openScreen({ screenId: "main" });
    },
  });
  return () => {};
}
