import { useRpc } from "@getpaseo/plugin/client";
import {
  Loading,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  type HubConfig,
  type LanguageChoice,
  looksAbsolute,
  type ResolvedAgent,
  resolveAgents,
} from "../shared/config";
import { type AgentStatus, pullRpc, type SourceStatus } from "../shared/contracts";
import { SCAN_KEY, useHub } from "./data";
import { LANGUAGE_NAMES, localizeError, type Translate } from "./i18n";
import { Banner, Button, Field, IconButton, Sheet, Switch, useKit } from "./kit";

type Editing = { kind: "source" } | { kind: "agent"; agent: ResolvedAgent | null };

function withAgent(values: HubConfig, agent: ResolvedAgent): HubConfig {
  const entry = { id: agent.id, name: agent.name, path: agent.path, enabled: agent.enabled };
  const isDefault = agent.builtin && agent.path === agent.defaultPath && agent.enabled;
  const index = values.agents.findIndex((a) => a.id === agent.id);
  const agents = values.agents.filter((a) => a.id !== agent.id);
  if (!isDefault) agents.splice(index < 0 ? agents.length : index, 0, entry);
  return { ...values, agents };
}

function agentHint(t: Translate, agent: ResolvedAgent, status: AgentStatus | undefined): string {
  const notes: string[] = [];
  if (agent.builtin && agent.path !== agent.defaultPath) notes.push(t("settings.modified"));
  if (!agent.builtin) notes.push(t("settings.custom"));
  if (status && !status.dir) notes.push(t("settings.notAbsolute"));
  else if (status && !status.exists) notes.push(t("settings.notCreated"));
  return notes.length > 0 ? `${agent.path} · ${notes.join(" · ")}` : agent.path;
}

function sourceHint(t: Translate, source: SourceStatus | undefined): string | undefined {
  if (!source?.exists) return undefined;
  return source.gitBranch !== null
    ? t("settings.gitHint", { branch: source.gitBranch, count: source.count })
    : t("settings.skillCount", { count: source.count });
}

export function SettingsPage() {
  const { colors, t } = useKit();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pullSources = useRpc(pullRpc);
  const { settings, scan } = useHub();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);

  if (settings.status === "loading") return <Loading />;
  if (settings.status === "error") {
    return (
      <Banner
        tone="danger"
        icon="CircleAlert"
        text={t("settings.readError", { error: settings.error })}
        action={<Button label={t("common.retry")} onPress={() => void settings.reload()} />}
      />
    );
  }
  if (settings.status === "invalid") {
    return (
      <Banner
        tone="danger"
        icon="CircleAlert"
        text={t("settings.invalid", { error: settings.error })}
        action={<Button label={t("settings.reset")} onPress={() => void settings.reset()} />}
      />
    );
  }

  const values = settings.values;
  const agents = resolveAgents(values.agents);
  const status = scan.data;

  async function save(next: HubConfig): Promise<boolean> {
    if (settings.status !== "ready") return false;
    const ok = await settings.save(next, settings.revision);
    if (!ok) {
      toast.error(t("settings.saveFailed"));
      void settings.reload();
    }
    return ok;
  }

  async function pull(path: string) {
    setPulling(path);
    try {
      const [result] = (await pullSources({ sources: [path] })).results;
      if (!result?.ok) toast.error(localizeError(t, result?.message ?? ""));
      else toast.show(result.changed ? result.message || t("pull.updated", { count: 1 }) : t("pull.upToDate"), {
        variant: "success",
      });
    } catch (error) {
      toast.error(localizeError(t, error));
    } finally {
      setPulling(null);
      await queryClient.invalidateQueries({ queryKey: SCAN_KEY });
    }
  }

  const languageOptions: { label: string; value: LanguageChoice }[] = [
    { label: t("lang.system"), value: "system" },
    { label: LANGUAGE_NAMES.en, value: "en" },
    { label: LANGUAGE_NAMES["zh-CN"], value: "zh-CN" },
  ];

  return (
    <View style={{ gap: 24 }}>
      <SettingsSection
        title={t("settings.sources")}
        trailing={<Button icon="Plus" label={t("common.add")} onPress={() => setEditing({ kind: "source" })} />}
      >
        <SettingsCard>
          {values.sources.length === 0 ? (
            <SettingsRow label={t("settings.sourcesEmpty")} hint={t("settings.sourcesEmptyHint")} />
          ) : (
            values.sources.map((path) => {
              const source = status?.sources.find((s) => s.path === path);
              return (
                <SettingsRow
                  key={path}
                  label={path}
                  hint={sourceHint(t, source)}
                  error={
                    source && !source.dir
                      ? t("settings.notAbsolute")
                      : source && !source.exists
                        ? t("settings.notFound")
                        : null
                  }
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    {source?.gitBranch != null ? (
                      <IconButton
                        icon="Download"
                        label={t("settings.pull", { path })}
                        disabled={pulling !== null}
                        onPress={() => void pull(path)}
                      />
                    ) : null}
                    <IconButton
                      icon="Trash2"
                      label={t("settings.remove", { path })}
                      disabled={settings.saving}
                      onPress={() => void save({ ...values, sources: values.sources.filter((p) => p !== path) })}
                    />
                  </View>
                </SettingsRow>
              );
            })
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("settings.agents")}
        trailing={
          <Button
            icon="Plus"
            label={t("settings.customAgent")}
            onPress={() => setEditing({ kind: "agent", agent: null })}
          />
        }
      >
        <SettingsCard>
          {agents.map((agent) => (
            <SettingsRow
              key={agent.id}
              label={agent.name}
              hint={agentHint(t, agent, status?.agents.find((a) => a.id === agent.id))}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <IconButton
                  icon="Pencil"
                  label={t("settings.edit", { name: agent.name })}
                  onPress={() => setEditing({ kind: "agent", agent })}
                />
                <Switch
                  value={agent.enabled}
                  label={t("settings.showInMatrix", { name: agent.name })}
                  disabled={settings.saving}
                  onChange={(enabled) => void save(withAgent(values, { ...agent, enabled }))}
                />
              </View>
            </SettingsRow>
          ))}
        </SettingsCard>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, marginTop: 8 }}>{t("settings.agentsNote")}</Text>
      </SettingsSection>

      <SettingsSection title={t("settings.language")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.languageLabel")}
            value={values.language}
            options={languageOptions}
            disabled={settings.saving}
            onValueChange={(language) => void save({ ...values, language })}
          />
        </SettingsCard>
      </SettingsSection>

      {editing?.kind === "source" ? (
        <SourceDialog
          sources={values.sources}
          onClose={() => setEditing(null)}
          onSave={(path) => save({ ...values, sources: [...values.sources, path] })}
        />
      ) : null}
      {editing?.kind === "agent" ? (
        <AgentDialog
          agent={editing.agent}
          onClose={() => setEditing(null)}
          onSave={(agent) => save(withAgent(values, agent))}
          onDelete={(agent) => save({ ...values, agents: values.agents.filter((a) => a.id !== agent.id) })}
        />
      ) : null}
    </View>
  );
}

function FormLabel({ text }: { text: string }) {
  const { colors } = useKit();
  return <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{text}</Text>;
}

function FormError({ text }: { text: string | null }) {
  const { colors } = useKit();
  return text ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{text}</Text> : null;
}

function SourceDialog({
  sources,
  onClose,
  onSave,
}: {
  sources: readonly string[];
  onClose(): void;
  onSave(path: string): Promise<boolean>;
}) {
  const { colors, compact, t } = useKit();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const value = path.trim();
    if (!looksAbsolute(value)) return setError(t("dialog.needAbsolute"));
    if (sources.includes(value)) return setError(t("dialog.duplicate"));
    setBusy(true);
    const ok = await onSave(value);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet title={t("dialog.addSource")} open onClose={onClose}>
      <FormLabel text={t("dialog.directory")} />
      <Field
        value={path}
        onChangeText={(text) => {
          setPath(text);
          setError(null);
        }}
        placeholder="~/skills"
        autoFocus={!compact}
        onSubmitEditing={() => void submit()}
      />
      <FormError text={error} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("dialog.sourceHint")}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label={t("common.cancel")} onPress={onClose} />
        <Button tone="primary" label={t("common.add")} disabled={busy} onPress={() => void submit()} />
      </View>
    </Sheet>
  );
}

function AgentDialog({
  agent,
  onClose,
  onSave,
  onDelete,
}: {
  agent: ResolvedAgent | null;
  onClose(): void;
  onSave(agent: ResolvedAgent): Promise<boolean>;
  onDelete(agent: ResolvedAgent): Promise<boolean>;
}) {
  const { colors, compact, t } = useKit();
  const [name, setName] = useState(agent?.name ?? "");
  const [path, setPath] = useState(agent?.path ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const builtin = agent?.builtin ?? false;

  async function finish(action: Promise<boolean>) {
    setBusy(true);
    const ok = await action;
    setBusy(false);
    if (ok) onClose();
  }

  function submit() {
    const nextName = name.trim();
    const nextPath = path.trim();
    if (!nextName) return setError(t("dialog.needName"));
    if (!looksAbsolute(nextPath)) return setError(t("dialog.needAbsolute"));
    void finish(
      onSave(
        agent
          ? { ...agent, name: builtin ? agent.name : nextName, path: nextPath }
          : {
              id: `custom-${Date.now().toString(36)}`,
              name: nextName,
              path: nextPath,
              enabled: true,
              builtin: false,
            },
      ),
    );
  }

  return (
    <Sheet
      title={agent ? t("dialog.editAgent", { name: agent.name }) : t("dialog.addAgent")}
      open
      onClose={onClose}
    >
      {builtin ? null : (
        <>
          <FormLabel text={t("dialog.name")} />
          <Field
            value={name}
            onChangeText={(text) => {
              setName(text);
              setError(null);
            }}
            placeholder="My Agent"
            autoFocus={!agent && !compact}
          />
        </>
      )}
      <FormLabel text={t("dialog.skillsDir")} />
      <Field
        value={path}
        onChangeText={(text) => {
          setPath(text);
          setError(null);
        }}
        placeholder="~/.my-agent/skills"
        onSubmitEditing={submit}
      />
      <FormError text={error} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        {builtin ? `${t("dialog.default", { path: agent?.defaultPath ?? "" })} ` : ""}
        {t("dialog.autoCreate")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {agent && builtin && path.trim() !== agent.defaultPath ? (
          <Button label={t("dialog.restoreDefault")} onPress={() => setPath(agent.defaultPath ?? "")} />
        ) : null}
        {agent && !builtin ? (
          <Button
            tone="danger"
            icon="Trash2"
            label={t("common.delete")}
            disabled={busy}
            onPress={() => void finish(onDelete(agent))}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <Button label={t("common.cancel")} onPress={onClose} />
        <Button tone="primary" label={t("common.save")} disabled={busy} onPress={submit} />
      </View>
    </Sheet>
  );
}
