import {
  Loading,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { type ReactNode, useState } from "react";
import { Text, View } from "react-native";
import {
  type HubConfig,
  KNOWN_DIRS,
  type LanguageChoice,
  looksAbsolute,
  type Target,
} from "../shared/config";
import type { SourceStatus, TargetStatus } from "../shared/contracts";
import { useHub } from "./data";
import { LANGUAGE_NAMES, localizeError, type Translate } from "./i18n";
import { Banner, Button, Chip, Field, IconButton, Sheet, useKit } from "./kit";
import { pullStatus, pullSummary, usePull } from "./pull";
import { targetLabel, targetReaders } from "./targets";

type Editing = { kind: "source" } | { kind: "target"; target: Target | null };

const samePath = (a: string, b: string) => a.trim().replace(/[\\/]+$/, "") === b.trim().replace(/[\\/]+$/, "");

function sourceHint(t: Translate, source: SourceStatus | undefined, status: string | null): string | undefined {
  if (!source?.exists) return undefined;
  const base =
    source.gitBranch !== null
      ? t("settings.gitHint", { branch: source.gitBranch, count: source.count })
      : t("settings.skillCount", { count: source.count });
  return status ? `${base} · ${status}` : base;
}

function targetHint(t: Translate, target: Target, status: TargetStatus | undefined): string {
  const notes = [target.path];
  const readers = targetReaders(target.path);
  if (readers) notes.push(t("settings.readers", { readers }));
  if (status && !status.dir) notes.push(t("settings.notAbsolute"));
  else if (status && !status.exists) notes.push(t("settings.notCreated"));
  return notes.join(" · ");
}

export function SettingsPage() {
  const { colors, t } = useKit();
  const toast = useToast();
  const { settings, scan } = useHub();
  const git = usePull(scan.data?.sources ?? []);
  const [editing, setEditing] = useState<Editing | null>(null);

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

  function saveTarget(target: Target) {
    const index = values.targets.findIndex((item) => item.id === target.id);
    const targets =
      index < 0 ? [...values.targets, target] : values.targets.map((item) => (item.id === target.id ? target : item));
    return save({ ...values, targets });
  }

  async function pullAll() {
    const summary = pullSummary(t, await git.pullAll());
    if (summary.error) toast.error(summary.text);
    else toast.show(summary.text, { variant: "success" });
  }

  const languageOptions: { label: string; value: LanguageChoice }[] = [
    { label: t("lang.system"), value: "system" },
    { label: LANGUAGE_NAMES.en, value: "en" },
    { label: LANGUAGE_NAMES["zh-CN"], value: "zh-CN" },
  ];

  return (
    <View style={{ gap: 24 }}>
      <Section
        title={t("settings.sources")}
        actions={
          <>
            {git.gitSources.length > 0 ? (
              <Button
                icon="Download"
                label={git.anyPulling ? t("pull.pending") : t("pull.all")}
                disabled={git.allPulling}
                onPress={() => void pullAll()}
              />
            ) : null}
            <Button icon="Plus" label={t("common.add")} onPress={() => setEditing({ kind: "source" })} />
          </>
        }
      >
        <SettingsCard>
          {values.sources.length === 0 ? (
            <SettingsRow label={t("settings.sourcesEmpty")} hint={t("settings.sourcesEmptyHint")} />
          ) : (
            values.sources.map((path) => {
              const source = status?.sources.find((s) => s.path === path);
              const pulling = source ? git.isPulling(source) : false;
              const result = source ? git.resultFor(source) : undefined;
              return (
                <SettingsRow
                  key={path}
                  label={path}
                  hint={sourceHint(t, source, pullStatus(t, pulling, result))}
                  error={
                    source && !source.dir
                      ? t("settings.notAbsolute")
                      : source && !source.exists
                        ? t("settings.notFound")
                        : result && !result.ok
                          ? localizeError(t, result.message)
                          : null
                  }
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    {source?.gitRoot != null ? (
                      <IconButton
                        icon={pulling ? "LoaderCircle" : "Download"}
                        label={t("settings.pull", { path })}
                        disabled={pulling}
                        onPress={() => void git.pull(source)}
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
      </Section>

      <Section
        title={t("settings.targets")}
        actions={
          <Button
            icon="Plus"
            label={t("settings.addTarget")}
            onPress={() => setEditing({ kind: "target", target: null })}
          />
        }
      >
        <SettingsCard>
          {values.targets.map((target) => (
            <SettingsRow
              key={target.id}
              label={targetLabel(t, target)}
              hint={targetHint(t, target, status?.targets.find((s) => s.id === target.id))}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <IconButton
                  icon="Pencil"
                  label={t("settings.edit", { name: targetLabel(t, target) })}
                  onPress={() => setEditing({ kind: "target", target })}
                />
                <IconButton
                  icon="Trash2"
                  label={t("settings.remove", { path: target.path })}
                  disabled={settings.saving}
                  onPress={() =>
                    void save({ ...values, targets: values.targets.filter((item) => item.id !== target.id) })
                  }
                />
              </View>
            </SettingsRow>
          ))}
        </SettingsCard>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("settings.targetsNote")}</Text>
      </Section>

      <Section title={t("settings.language")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.languageLabel")}
            value={values.language}
            options={languageOptions}
            disabled={settings.saving}
            onValueChange={(language) => void save({ ...values, language })}
          />
        </SettingsCard>
      </Section>

      {editing?.kind === "source" ? (
        <SourceDialog
          sources={values.sources}
          onClose={() => setEditing(null)}
          onSave={(path) => save({ ...values, sources: [...values.sources, path] })}
        />
      ) : null}
      {editing?.kind === "target" ? (
        <TargetDialog
          target={editing.target}
          targets={values.targets}
          onClose={() => setEditing(null)}
          onSave={saveTarget}
        />
      ) : null}
    </View>
  );
}

/**
 * Section heading with optional actions on the same line. The host SettingsSection `trailing` slot
 * is shorter than these buttons, so they overlapped the card below on mobile.
 */
function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { colors } = useKit();
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          minHeight: 32,
          paddingLeft: 4,
        }}
      >
        <Text style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 13, fontWeight: "500" }}>{title}</Text>
        {actions ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{actions}</View> : null}
      </View>
      {children}
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

function TargetDialog({
  target,
  targets,
  onClose,
  onSave,
}: {
  target: Target | null;
  targets: readonly Target[];
  onClose(): void;
  onSave(target: Target): Promise<boolean>;
}) {
  const { colors, compact, t } = useKit();
  const [name, setName] = useState(target?.name ?? "");
  const [path, setPath] = useState(target?.path ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = targets.filter((item) => item.id !== target?.id);
  const suggestions = KNOWN_DIRS.filter((dir) => !others.some((item) => samePath(item.path, dir.path)));

  async function submit() {
    const nextPath = path.trim();
    if (!looksAbsolute(nextPath)) return setError(t("dialog.needAbsolute"));
    if (others.some((item) => samePath(item.path, nextPath))) return setError(t("dialog.duplicateTarget"));
    setBusy(true);
    const ok = await onSave({
      id: target?.id ?? `t-${Date.now().toString(36)}`,
      name: name.trim(),
      path: nextPath,
    });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet
      title={target ? t("dialog.editTarget", { name: targetLabel(t, target) }) : t("dialog.addTarget")}
      open
      onClose={onClose}
    >
      <FormLabel text={t("dialog.directory")} />
      <Field
        value={path}
        onChangeText={(text) => {
          setPath(text);
          setError(null);
        }}
        placeholder="~/.agents/skills"
        autoFocus={!target && !compact}
        onSubmitEditing={() => void submit()}
      />
      {suggestions.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("dialog.known")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {suggestions.map((dir) => (
              <Chip
                key={dir.path}
                label={`${dir.name || t("target.shared")} · ${dir.path}`}
                active={samePath(path, dir.path)}
                onPress={() => {
                  setPath(dir.path);
                  setError(null);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}
      <FormLabel text={t("dialog.nameOptional")} />
      <Field value={name} onChangeText={setName} placeholder={targetLabel(t, { name: "", path })} />
      <FormError text={error} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("dialog.autoCreate")}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label={t("common.cancel")} onPress={onClose} />
        <Button tone="primary" label={t("common.save")} disabled={busy} onPress={() => void submit()} />
      </View>
    </Sheet>
  );
}
