import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { shortName } from "../shared/config";
import {
  type AgentStatus,
  applyRpc,
  type BrokenLink,
  type Cell,
  type LinkOp,
  MAX_BATCH,
  pruneRpc,
  pullRpc,
  readSkillRpc,
  type Skill,
} from "../shared/contracts";
import { SCAN_KEY, useHub } from "./data";
import { localizeError, type MessageKey, type Translate } from "./i18n";
import {
  Banner,
  baseName,
  Button,
  Checkbox,
  Chip,
  EmptyState,
  Field,
  IconButton,
  MONO,
  Sheet,
  useKit,
  Wash,
} from "./kit";

const ROW_HEIGHT = 44;
const CHECK_WIDTH = 32;

const opKey = (skill: string, agentId: string) => `${agentId}\n${skill}`;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += MAX_BATCH) out.push(items.slice(i, i + MAX_BATCH));
  return out;
}

function matches(skill: Skill, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [skill.name, skill.dirName, skill.description, skill.path].some((value) =>
    value.toLowerCase().includes(q),
  );
}

function cellMessage(t: Translate, skill: Skill, agent: AgentStatus, cell: Cell): string {
  const vars = { agent: agent.name, skill: skill.name, target: cell.target ?? "" };
  if (cell.state === "broken") return t("cell.brokenToast", vars);
  if (cell.state === "source") return t("cell.sourceToast", vars);
  const key: Record<NonNullable<Cell["reason"]>, MessageKey> = {
    directory: "cell.conflictDirectory",
    file: "cell.conflictFile",
    link: "cell.conflictLink",
    error: "cell.conflictError",
  };
  return t(key[cell.reason ?? "error"], vars);
}

export function SkillsPage({ onOpenSettings }: { onOpenSettings(): void }) {
  const { colors, compact, t } = useKit();
  const toast = useToast();
  const queryClient = useQueryClient();
  const applyOps = useRpc(applyRpc);
  const pruneLinks = useRpc(pruneRpc);
  const pullSources = useRpc(pullRpc);
  const { settings, scan } = useHub();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<{ skill: Skill; open: boolean } | null>(null);
  const [brokenOpen, setBrokenOpen] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [pulling, setPulling] = useState(false);

  const data = scan.data;
  const agents = useMemo(() => data?.agents.filter((a) => a.enabled && a.dir) ?? [], [data]);
  const visible = useMemo(
    () => (data?.skills ?? []).filter((skill) => matches(skill, query.trim())),
    [data, query],
  );
  const chosen = useMemo(
    () => (data?.skills ?? []).filter((skill) => selected.has(skill.path)),
    [data, selected],
  );
  const batchAgents = agents.filter((agent) => !excluded.has(agent.id));
  const missingSources = data?.sources.filter((source) => !source.exists) ?? [];
  const gitSources = data?.sources.filter((source) => source.gitBranch !== null) ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: SCAN_KEY });

  async function run(ops: LinkOp[], skipped = 0) {
    if (ops.length === 0) return;
    const keys = ops.map((op) => opKey(op.skill, op.agentId));
    setPending((prev) => new Set([...prev, ...keys]));
    try {
      const results = [];
      for (const chunk of chunks(ops)) results.push(...(await applyOps({ ops: chunk })).results);
      const failed = results.filter((result) => !result.ok);
      if (failed.length === 1) toast.error(localizeError(t, failed[0].error));
      else if (failed.length > 1)
        toast.error(t("skills.failed", { count: failed.length, error: localizeError(t, failed[0].error) }));
      else if (skipped > 0)
        toast.show(t("skills.doneSkipped", { count: ops.length, skipped }), { variant: "warning" });
      else if (ops.length > 1) toast.show(t("skills.done", { count: ops.length }), { variant: "success" });
    } catch (error) {
      toast.error(localizeError(t, error));
    } finally {
      await refresh();
      setPending((prev) => {
        const next = new Set(prev);
        for (const key of keys) next.delete(key);
        return next;
      });
    }
  }

  function pressCell(skill: Skill, agent: AgentStatus) {
    const cell = skill.cells[agent.id] ?? { state: "none" };
    const op = { skill: skill.path, agentId: agent.id };
    if (cell.state === "linked") return void run([{ ...op, action: "undeploy" }]);
    if (cell.state === "none") return void run([{ ...op, action: "deploy" }]);
    toast.show(cellMessage(t, skill, agent, cell), {
      variant: cell.state === "source" ? "info" : "warning",
      durationMs: 4000,
    });
  }

  function batch(action: LinkOp["action"]) {
    const ops: LinkOp[] = [];
    let skipped = 0;
    for (const skill of chosen) {
      for (const agent of batchAgents) {
        const state = skill.cells[agent.id]?.state;
        if (action === "deploy" && state === "none") ops.push({ action, skill: skill.path, agentId: agent.id });
        else if (action === "undeploy" && state === "linked") ops.push({ action, skill: skill.path, agentId: agent.id });
        else if (action === "deploy" && (state === "conflict" || state === "broken")) skipped++;
      }
    }
    if (ops.length === 0) {
      toast.show(skipped > 0 ? t("skills.nothingToDeploy", { skipped }) : t("skills.nothingToChange"), {
        variant: skipped > 0 ? "warning" : "default",
      });
      return;
    }
    void run(ops, skipped);
  }

  async function prune(links: readonly BrokenLink[]) {
    setPruning(true);
    try {
      let removed = 0;
      const errors: { path: string; error: string }[] = [];
      for (const chunk of chunks(links.map((link) => link.path))) {
        const result = await pruneLinks({ paths: chunk });
        removed += result.removed;
        errors.push(...result.errors);
      }
      if (errors.length > 0) {
        const first = `${baseName(errors[0].path)}: ${localizeError(t, errors[0].error)}`;
        toast.error(t("broken.partial", { count: removed, failed: errors.length, error: first }));
      } else {
        toast.show(t("broken.done", { count: removed }), { variant: "success" });
      }
      setBrokenOpen(false);
    } catch (error) {
      toast.error(localizeError(t, error));
    } finally {
      setPruning(false);
      await refresh();
    }
  }

  async function pullAll() {
    setPulling(true);
    try {
      const { results } = await pullSources({ sources: gitSources.map((source) => source.path) });
      const failed = results.find((result) => !result.ok);
      const changed = results.filter((result) => result.changed).length;
      if (failed) {
        toast.error(t("pull.failed", { source: failed.source, error: localizeError(t, failed.message) }));
      } else {
        toast.show(changed > 0 ? t("pull.updated", { count: changed }) : t("pull.upToDate"), {
          variant: "success",
        });
      }
    } catch (error) {
      toast.error(localizeError(t, error));
    } finally {
      setPulling(false);
      await refresh();
    }
  }

  function toggleAll() {
    const all = visible.length > 0 && visible.every((skill) => selected.has(skill.path));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const skill of visible) {
        if (all) next.delete(skill.path);
        else next.add(skill.path);
      }
      return next;
    });
  }

  function toggleOne(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <Banner
        tone="danger"
        icon="CircleAlert"
        text={t("skills.settingsError", { error: settings.error })}
        action={<Button icon="Settings" label={t("common.openSettings")} onPress={onOpenSettings} />}
      />
    );
  }
  if (settings.status === "loading" || (scan.isPending && !scan.isError)) return <Loading />;
  if (scan.isError && !data) {
    return (
      <Banner
        tone="danger"
        icon="CircleAlert"
        text={t("skills.scanError", { error: localizeError(t, scan.error) })}
        action={<Button label={t("common.retry")} onPress={() => void scan.refetch()} />}
      />
    );
  }
  if (!data) return <Loading />;

  if (data.sources.length === 0) {
    return (
      <EmptyState
        icon="FolderPlus"
        title={t("skills.emptySources.title")}
        text={t("skills.emptySources.text")}
        action={
          <Button tone="primary" icon="Settings" label={t("common.openSettings")} onPress={onOpenSettings} />
        }
      />
    );
  }

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.path));
  const someVisibleSelected = visible.some((s) => selected.has(s.path));

  return (
    <View style={{ flex: 1, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 180, justifyContent: "center" }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder={t("skills.search")}
            accessibilityLabel={t("skills.searchLabel")}
            style={{ paddingLeft: 32, paddingRight: query ? 34 : 10 }}
          />
          <View style={{ position: "absolute", left: 10, pointerEvents: "none" }}>
            <Icon name="Search" size={15} color={colors.foregroundMuted} />
          </View>
          {query ? (
            <View style={{ position: "absolute", right: 4 }}>
              <IconButton icon="X" label={t("skills.clearSearch")} onPress={() => setQuery("")} />
            </View>
          ) : null}
        </View>
        {gitSources.length > 0 ? (
          <Button
            icon="Download"
            label={pulling ? t("skills.pulling") : t("skills.pull")}
            disabled={pulling}
            onPress={() => void pullAll()}
          />
        ) : null}
        <Button
          icon="RefreshCw"
          label={scan.isFetching ? t("skills.refreshing") : t("skills.refresh")}
          disabled={scan.isFetching}
          onPress={() => void refresh()}
        />
      </View>
      {!compact ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {t("skills.stats", { skills: data.skills.length, agents: agents.length })}
        </Text>
      ) : null}

      {chosen.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            padding: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface1,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
            {t("skills.selected", { count: chosen.length })}
          </Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("skills.targets")}</Text>
          {agents.map((agent) => (
            <Chip
              key={agent.id}
              label={compact ? shortName(agent) : agent.name}
              active={!excluded.has(agent.id)}
              onPress={() =>
                setExcluded((prev) => {
                  const next = new Set(prev);
                  if (next.has(agent.id)) next.delete(agent.id);
                  else next.add(agent.id);
                  return next;
                })
              }
            />
          ))}
          <View style={{ flexDirection: "row", gap: 8, marginLeft: "auto" }}>
            <Button
              tone="primary"
              icon="Link"
              label={t("skills.deploy")}
              disabled={batchAgents.length === 0}
              onPress={() => batch("deploy")}
            />
            <Button
              icon="Unlink"
              label={t("skills.undeploy")}
              disabled={batchAgents.length === 0}
              onPress={() => batch("undeploy")}
            />
            <IconButton icon="X" label={t("skills.clearSelection")} onPress={() => setSelected(new Set())} />
          </View>
        </View>
      ) : null}

      {data.broken.length > 0 ? (
        <Banner
          tone="warning"
          icon="Unlink"
          text={t("skills.brokenBanner", { count: data.broken.length })}
          action={<Button label={t("skills.view")} onPress={() => setBrokenOpen(true)} />}
        />
      ) : null}
      {missingSources.length > 0 ? (
        <Banner
          tone="danger"
          icon="FolderX"
          text={t("skills.missingSources", { paths: missingSources.map((source) => source.path).join(", ") })}
        />
      ) : null}
      {data.truncated ? <Banner tone="warning" icon="TriangleAlert" text={t("skills.truncated")} /> : null}

      {data.skills.length === 0 ? (
        <EmptyState
          icon="SearchX"
          title={t("skills.emptySkills.title")}
          text={t("skills.emptySkills.text")}
          action={<Button icon="Settings" label={t("skills.checkSources")} onPress={onOpenSettings} />}
        />
      ) : agents.length === 0 ? (
        <EmptyState
          icon="Bot"
          title={t("skills.noAgents.title")}
          text={t("skills.noAgents.text")}
          action={<Button icon="Settings" label={t("common.openSettings")} onPress={onOpenSettings} />}
        />
      ) : (
        <Matrix
          skills={visible}
          allSkills={data.skills}
          agents={agents}
          selected={selected}
          pending={pending}
          allSelected={allVisibleSelected}
          someSelected={someVisibleSelected}
          onToggleAll={toggleAll}
          onToggle={toggleOne}
          onCell={pressCell}
          onOpen={(skill) => setPreview({ skill, open: true })}
          onAgent={(agent) =>
            toast.show(
              t(agent.exists ? "skills.agentDir" : "skills.agentDirMissing", {
                name: agent.name,
                dir: agent.dir ?? agent.path,
              }),
              { durationMs: 4000 },
            )
          }
        />
      )}

      {preview ? (
        <Preview
          skill={preview.skill}
          parentName={data.skills.find((s) => s.path === preview.skill.parent)?.name ?? null}
          childCount={data.skills.filter((s) => s.parent === preview.skill.path).length}
          open={preview.open}
          agents={agents}
          onClose={() => setPreview({ ...preview, open: false })}
        />
      ) : null}

      <Sheet title={t("broken.title")} open={brokenOpen} onClose={() => setBrokenOpen(false)}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t("broken.text")}</Text>
        {data.broken.map((link) => (
          <View key={link.path} style={{ gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {data.agents.find((a) => a.id === link.agentId)?.name ?? link.agentId} · {baseName(link.path)}
            </Text>
            <Text selectable style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: MONO }}>
              {link.path} → {link.target}
            </Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button label={t("common.cancel")} onPress={() => setBrokenOpen(false)} />
          <Button
            tone="primary"
            icon="Trash2"
            label={pruning ? t("broken.cleaning") : t("broken.clean")}
            disabled={pruning}
            onPress={() => void prune(data.broken)}
          />
        </View>
      </Sheet>
    </View>
  );
}

interface MatrixProps {
  skills: readonly Skill[];
  allSkills: readonly Skill[];
  agents: readonly AgentStatus[];
  selected: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll(): void;
  onToggle(path: string): void;
  onCell(skill: Skill, agent: AgentStatus): void;
  onOpen(skill: Skill): void;
  onAgent(agent: AgentStatus): void;
}

/**
 * Agent columns take what is left after a minimum name column, within limits; the name column
 * gets the rest. Only when even the minimums do not fit does the table scroll sideways.
 */
function fitColumns(width: number, count: number, compact: boolean) {
  const nameMin = compact ? 96 : 200;
  const nameFloor = 80;
  const column = Math.max(
    42,
    Math.min(compact ? 64 : 84, Math.floor((width - CHECK_WIDTH - nameMin) / Math.max(count, 1))),
  );
  const name = Math.max(nameFloor, width - CHECK_WIDTH - column * count);
  return { column, name, total: CHECK_WIDTH + name + column * count };
}

function Matrix(props: MatrixProps) {
  const { colors, compact, t } = useKit();
  const { skills, agents } = props;
  const [width, setWidth] = useState(0);
  const { column, name: nameWidth, total } = fitColumns(width, agents.length, compact);
  const scrolls = width > 0 && total > width;

  const linkedCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const skill of props.allSkills)
      for (const agent of agents)
        if (skill.cells[agent.id]?.state === "linked") counts[agent.id] = (counts[agent.id] ?? 0) + 1;
    return counts;
  }, [props.allSkills, agents]);

  const table = (
    // Inside the horizontal ScrollView the row container stretches the height; flex would
    // shrink the table to the viewport width instead.
    <View style={scrolls ? { width: total } : { flex: 1, width: total }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface1,
        }}
      >
        <View style={{ width: CHECK_WIDTH, alignItems: "center" }}>
          <Checkbox
            checked={props.allSelected}
            mixed={!props.allSelected && props.someSelected}
            label={t("skills.selectAll")}
            onPress={props.onToggleAll}
          />
        </View>
        <Text
          numberOfLines={1}
          style={{ width: nameWidth, color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}
        >
          {t("skills.column", { count: skills.length })}
        </Text>
        {agents.map((agent) => (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            accessibilityLabel={t("skills.agentsColumn", { name: agent.name })}
            onPress={() => props.onAgent(agent)}
            style={{ width: column, alignItems: "center", paddingHorizontal: 2, paddingVertical: 4 }}
          >
            <Text
              numberOfLines={compact ? 1 : 2}
              adjustsFontSizeToFit={compact}
              minimumFontScale={0.7}
              style={{
                color: colors.foreground,
                fontSize: compact ? 10 : 11,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              {compact ? shortName(agent) : agent.name}
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{linkedCount[agent.id] ?? 0}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={skills}
        keyExtractor={(skill) => skill.path}
        extraData={[props.selected, props.pending, agents, column, nameWidth]}
        initialNumToRender={30}
        windowSize={11}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        ListEmptyComponent={
          <Text style={{ color: colors.foregroundMuted, fontSize: 13, padding: 16 }}>{t("skills.noMatch")}</Text>
        }
        renderItem={({ item }) => (
          <Row
            skill={item}
            agents={agents}
            column={column}
            nameWidth={nameWidth}
            selected={props.selected.has(item.path)}
            pending={props.pending}
            onToggle={props.onToggle}
            onCell={props.onCell}
            onOpen={props.onOpen}
          />
        )}
      />
    </View>
  );

  return (
    <View
      onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width) - 2)}
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: colors.surface0,
      }}
    >
      {width <= 0 ? null : scrolls ? (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          {table}
        </ScrollView>
      ) : (
        table
      )}
    </View>
  );
}

function Row({
  skill,
  agents,
  column,
  nameWidth,
  selected,
  pending,
  onToggle,
  onCell,
  onOpen,
}: {
  skill: Skill;
  agents: readonly AgentStatus[];
  column: number;
  nameWidth: number;
  selected: boolean;
  pending: ReadonlySet<string>;
  onToggle(path: string): void;
  onCell(skill: Skill, agent: AgentStatus): void;
  onOpen(skill: Skill): void;
}) {
  const { colors, compact, t } = useKit();
  const indent = skill.depth * (compact ? 10 : 16);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: ROW_HEIGHT,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {selected ? <Wash color={colors.accent} opacity={0.07} /> : null}
      <View style={{ width: CHECK_WIDTH, alignItems: "center" }}>
        <Checkbox
          checked={selected}
          label={t("skills.select", { name: skill.name })}
          onPress={() => onToggle(skill.path)}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("skills.preview", { name: skill.name })}
        onPress={() => onOpen(skill)}
        style={{
          width: nameWidth,
          height: ROW_HEIGHT,
          paddingLeft: indent,
          paddingRight: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        {skill.depth > 0 ? <Icon name="CornerDownRight" size={12} color={colors.foregroundMuted} /> : null}
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, color: colors.foreground, fontSize: 13, fontWeight: "500" }}
        >
          {skill.name}
        </Text>
        {skill.duplicate ? <Tag label={t("skills.duplicate")} color={colors.statusWarning} /> : null}
      </Pressable>
      {agents.map((agent) => (
        <View key={agent.id} style={{ width: column, alignItems: "center" }}>
          <CellButton
            cell={skill.cells[agent.id]}
            pending={pending.has(opKey(skill.path, agent.id))}
            label={`${skill.name} → ${agent.name}`}
            onPress={() => onCell(skill, agent)}
          />
        </View>
      ))}
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{ paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, borderColor: color, overflow: "hidden" }}
    >
      <Wash color={color} opacity={0.1} />
      <Text style={{ color, fontSize: 10, lineHeight: 15 }}>{label}</Text>
    </View>
  );
}

const STATE_KEY: Record<Cell["state"], MessageKey> = {
  linked: "cell.linked",
  none: "cell.none",
  conflict: "cell.conflict",
  broken: "cell.broken",
  source: "cell.source",
};

function CellButton({
  cell,
  pending,
  label,
  onPress,
}: {
  cell: Cell | undefined;
  pending: boolean;
  label: string;
  onPress(): void;
}) {
  const { colors, t } = useKit();
  const state = cell?.state ?? "none";
  const look = {
    linked: { color: colors.accent, icon: "Check", wash: 1, iconColor: colors.accentForeground },
    none: { color: colors.border, icon: null, wash: 0, iconColor: colors.foregroundMuted },
    conflict: { color: colors.statusWarning, icon: "TriangleAlert", wash: 0.12, iconColor: colors.statusWarning },
    broken: { color: colors.statusDanger, icon: "Unlink", wash: 0.12, iconColor: colors.statusDanger },
    source: { color: colors.foregroundMuted, icon: "Folder", wash: 0.12, iconColor: colors.foregroundMuted },
  }[state];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${t(STATE_KEY[state])}`}
      accessibilityState={{ busy: pending, disabled: pending }}
      disabled={pending}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 26,
        height: 26,
        borderRadius: 7,
        borderWidth: 1.5,
        borderColor: look.color,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: pending ? 0.35 : pressed ? 0.7 : 1,
      })}
    >
      {look.wash > 0 ? <Wash color={look.color} opacity={look.wash} /> : null}
      {look.icon ? <Icon name={look.icon} size={14} color={look.iconColor} /> : null}
    </Pressable>
  );
}

function Preview({
  skill,
  parentName,
  childCount,
  open,
  agents,
  onClose,
}: {
  skill: Skill;
  parentName: string | null;
  childCount: number;
  open: boolean;
  agents: readonly AgentStatus[];
  onClose(): void;
}) {
  const { colors, t } = useKit();
  const readSkill = useRpc(readSkillRpc);
  const doc = useQuery({
    queryKey: ["skill-hub", "read", skill.path],
    queryFn: () => readSkill({ path: skill.path }),
    enabled: open,
  });
  const deployed = agents.filter((agent) => skill.cells[agent.id]?.state === "linked");
  return (
    <Sheet title={skill.name} open={open} onClose={onClose}>
      {skill.description ? (
        <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 21 }}>{skill.description}</Text>
      ) : null}
      <View style={{ gap: 4 }}>
        <Text selectable style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: MONO }}>
          {skill.path}
        </Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {deployed.length > 0
            ? t("preview.deployedTo", { agents: deployed.map((a) => a.name).join(", ") })
            : t("preview.notDeployed")}
        </Text>
        {parentName !== null || childCount > 0 ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {[
              parentName !== null ? t("preview.parent", { name: parentName }) : null,
              childCount > 0 ? t("preview.children", { count: childCount }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>
      <View style={{ height: 1, backgroundColor: colors.border }} />
      {doc.isPending ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t("common.loading")}</Text>
      ) : doc.isError ? (
        <Text style={{ color: colors.statusDanger, fontSize: 13 }}>{localizeError(t, doc.error)}</Text>
      ) : (
        <>
          <Markdown>{doc.data.body}</Markdown>
          {doc.data.truncated ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("preview.truncated")}</Text>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
