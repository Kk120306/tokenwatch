import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import { cacheGradeSortValue, describeCacheGrade } from "../cache-score.js";
import type { ParsedTurn, PricingTable, StorageDetectionSummary, StorageResult } from "../types.js";
import {
  filterTurns,
  normalizeModel,
  recommendModel,
  summarizeModels,
  summarizeStats,
  uniqueModels,
  uniqueTopics
} from "./selectors.js";

type ActiveView = "prompts" | "models" | "stats";
type FilterMode = "models" | "topics";
type PromptSortMode = "time" | "cacheGrade";

export interface AppState {
  turns: ParsedTurn[];
  activeView: ActiveView;
  filterModels: string[];
  filterTopics: string[];
  expandedTurnId: number | null;
  showTokens: boolean;
  isLive: boolean;
}

export interface AppProps {
  turns: ParsedTurn[];
  pricing: PricingTable;
  detectionSummary: StorageDetectionSummary | null;
  version: string;
  warnings?: readonly string[];
  lastTurnReceivedAt?: number | null;
  inputEnabled?: boolean;
  onQuit?: () => void;
}

interface FilterOverlayState {
  mode: FilterMode;
  cursor: number;
  selected: string[];
}

const BAR_WIDTH = 44;
const STALE_AFTER_MS = 30_000;
const SHORTCUTS = "[1] Prompts  [2] Models  [3] Stats  [g] Cache sort  [f] Models  [t] Topics  [c] Toggle tokens  [q] Quit";

export default function App({
  turns,
  pricing,
  detectionSummary,
  version,
  warnings = [],
  lastTurnReceivedAt = null,
  inputEnabled,
  onQuit
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdin, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const width = Math.max(80, stdout.columns ?? 80);
  const height = Math.max(24, stdout.rows ?? 24);
  const availableModels = useMemo(() => uniqueModels(turns), [turns]);
  const availableTopics = useMemo(() => uniqueTopics(turns), [turns]);
  const [activeView, setActiveView] = useState<ActiveView>("prompts");
  const [uncheckedModels, setUncheckedModels] = useState<string[]>([]);
  const [uncheckedTopics, setUncheckedTopics] = useState<string[]>([]);
  const [expandedTurnId, setExpandedTurnId] = useState<number | null>(null);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0);
  const [showTokens, setShowTokens] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [overlay, setOverlay] = useState<FilterOverlayState | null>(null);
  const [promptSortMode, setPromptSortMode] = useState<PromptSortMode>("time");

  useEffect(() => {
    const timer = setInterval(() => {
      setIsLive((current) => !current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const filterModels = useMemo(
    () => selectedFilters(availableModels, uncheckedModels),
    [availableModels, uncheckedModels]
  );
  const filterTopics = useMemo(
    () => selectedFilters(availableTopics, uncheckedTopics),
    [availableTopics, uncheckedTopics]
  );

  const filteredTurns = useMemo(
    () => filterTurns(turns, filterModels, filterTopics),
    [turns, filterModels, filterTopics]
  );
  const visibleTurns = useMemo(
    () => sortPromptTurns(filteredTurns, promptSortMode),
    [filteredTurns, promptSortMode]
  );

  useEffect(() => {
    setSelectedTurnIndex((current) => clamp(current, 0, Math.max(0, visibleTurns.length - 1)));
  }, [visibleTurns.length]);

  useInput((input, key) => {
    if (overlay) {
      handleOverlayInput(input, key);
      return;
    }

    if (input === "q") {
      onQuit?.();
      exit();
      return;
    }
    if (input === "1") {
      setActiveView("prompts");
      return;
    }
    if (input === "2") {
      setActiveView("models");
      return;
    }
    if (input === "3") {
      setActiveView("stats");
      return;
    }
    if (input === "c") {
      setShowTokens((current) => !current);
      return;
    }
    if (input === "g") {
      setPromptSortMode((current) => current === "cacheGrade" ? "time" : "cacheGrade");
      setActiveView("prompts");
      return;
    }
    if (input === "f") {
      setOverlay({ mode: "models", cursor: 0, selected: filterModels });
      return;
    }
    if (input === "t") {
      setOverlay({ mode: "topics", cursor: 0, selected: filterTopics });
      return;
    }
    if (activeView === "prompts" && key.upArrow) {
      setSelectedTurnIndex((current) => clamp(current - 1, 0, Math.max(0, visibleTurns.length - 1)));
      return;
    }
    if (activeView === "prompts" && key.downArrow) {
      setSelectedTurnIndex((current) => clamp(current + 1, 0, Math.max(0, visibleTurns.length - 1)));
      return;
    }
    if (activeView === "prompts" && key.return) {
      const selected = visibleTurns[selectedTurnIndex];
      setExpandedTurnId((current) => current === selected?.id ? null : selected?.id ?? null);
    }
  }, {
    isActive: inputEnabled ?? (isRawModeSupported && typeof stdin.setRawMode === "function")
  });

  const maxTurnCost = Math.max(...visibleTurns.map((turn) => turn.costUsd), 0);
  const contentHeight = Math.max(8, height - 5);
  const stale = lastTurnReceivedAt === null || Date.now() - lastTurnReceivedAt > STALE_AFTER_MS;
  const liveColor = stale ? "gray" : "green";
  const liveDim = stale || !isLive;

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>tokenwatch v{version}</Text>
        <Text color={liveColor} dimColor={liveDim}>● LIVE</Text>
      </Box>

      <Box flexDirection="column" height={contentHeight} overflow="hidden">
        {turns.length === 0 ? (
          <Onboarding detectionSummary={detectionSummary} />
        ) : overlay ? (
          <FilterOverlay overlay={overlay} availableModels={availableModels} availableTopics={availableTopics} />
        ) : activeView === "prompts" ? (
          <PromptsView
            turns={visibleTurns}
            maxTurnCost={maxTurnCost}
            expandedTurnId={expandedTurnId}
            selectedTurnIndex={selectedTurnIndex}
            showTokens={showTokens}
          />
        ) : activeView === "models" ? (
          <ModelsView turns={filteredTurns} showTokens={showTokens} />
        ) : (
          <StatsView turns={filteredTurns} pricing={pricing} />
        )}
      </Box>

      {warnings.length > 0 ? (
        <Text color="yellow" wrap="truncate-end">{warnings.at(-1)}</Text>
      ) : (
        <Text dimColor>{viewLabel(activeView, filterModels.length, filterTopics.length)}</Text>
      )}
      <Text inverse>{SHORTCUTS}</Text>
    </Box>
  );

  function handleOverlayInput(input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }): void {
    const currentOverlay = overlay;
    if (!currentOverlay) {
      return;
    }
    const options = currentOverlay.mode === "models" ? availableModels : availableTopics;
    if (key.escape) {
      setOverlay(null);
      return;
    }
    if (key.return) {
      if (currentOverlay.mode === "models") {
        setUncheckedModels(unselectedFilters(availableModels, currentOverlay.selected));
      } else {
        setUncheckedTopics(unselectedFilters(availableTopics, currentOverlay.selected));
      }
      setOverlay(null);
      return;
    }
    if (key.upArrow) {
      setOverlay({ ...currentOverlay, cursor: clamp(currentOverlay.cursor - 1, 0, Math.max(0, options.length - 1)) });
      return;
    }
    if (key.downArrow) {
      setOverlay({ ...currentOverlay, cursor: clamp(currentOverlay.cursor + 1, 0, Math.max(0, options.length - 1)) });
      return;
    }
    if (input === " ") {
      const option = options[currentOverlay.cursor];
      if (!option) {
        return;
      }
      const selected = currentOverlay.selected.includes(option)
        ? currentOverlay.selected.filter((item) => item !== option)
        : [...currentOverlay.selected, option];
      setOverlay({ ...currentOverlay, selected });
    }
  }
}

function Onboarding({ detectionSummary }: { detectionSummary: StorageDetectionSummary | null }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={2}>
      <Text bold>  tokenwatch is ready</Text>
      <Text dimColor>  ─────────────────────────────────────────</Text>
      <Text>{formatDetection("Claude Code", detectionSummary?.claude)}</Text>
      <Text>{formatDetection("Codex CLI", detectionSummary?.codex)}</Text>
      <Text> </Text>
      <Text>  Send a prompt in your AI CLI to see usage appear here.</Text>
    </Box>
  );
}

function PromptsView({
  turns,
  maxTurnCost,
  expandedTurnId,
  selectedTurnIndex,
  showTokens
}: {
  turns: readonly ParsedTurn[];
  maxTurnCost: number;
  expandedTurnId: number | null;
  selectedTurnIndex: number;
  showTokens: boolean;
}): React.JSX.Element {
  if (turns.length === 0) {
    return <Text dimColor>No prompts match the current filters.</Text>;
  }

  return (
    <Box flexDirection="column">
      {turns.map((turn, index) => (
        <PromptRow
          key={turn.id}
          turn={turn}
          displayIndex={index + 1}
          selected={index === selectedTurnIndex}
          expanded={expandedTurnId === turn.id}
          maxTurnCost={maxTurnCost}
          showTokens={showTokens}
        />
      ))}
    </Box>
  );
}

function PromptRow({
  turn,
  displayIndex,
  selected,
  expanded,
  maxTurnCost,
  showTokens
}: {
  turn: ParsedTurn;
  displayIndex: number;
  selected: boolean;
  expanded: boolean;
  maxTurnCost: number;
  showTokens: boolean;
}): React.JSX.Element {
  const cost = getCostLabel(turn.costUsd);
  const model = normalizeModel(turn.model);
  const cache = getCacheGradeLabel(turn.cacheGrade);
  return (
    <Box flexDirection="column">
      <Text color={selected ? "cyan" : undefined}>
        {selected ? ">" : " "} #{displayIndex.toString().padEnd(4)} {model.padEnd(22)} {(turn.topic ?? "untagged").padEnd(18)}{" "}
        <Text color={cache.color}>{turn.cacheGrade}</Text>{" "}
        <Text color={cost.color} dimColor={cost.dim}>{cost.label.padEnd(14)}</Text>
        {showTokens ? formatTokenLine(turn) : `~${formatUsd(turn.costUsd)}`}
      </Text>
      <Text dimColor>      {costBar(turn.costUsd, maxTurnCost)}</Text>
      {expanded ? (
        <>
          <Text wrap="truncate-end">      "{turn.promptText ?? "prompt text unavailable"}"</Text>
          <Text>      Cache: <Text color={cache.color}>{turn.cacheGrade}</Text> — {cache.description}, saving ~{formatUsd(turn.cacheSavingsUsd)} this prompt</Text>
          <Text dimColor>      {formatTokenLine(turn)}</Text>
          {turn.goal ? (
            <Text dimColor>      goal {turn.goal.status} · {formatCount(turn.goal.tokensUsed)} used · {turn.goal.objective || turn.goal.goalId}</Text>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function ModelsView({
  turns,
  showTokens
}: {
  turns: readonly ParsedTurn[];
  showTokens: boolean;
}): React.JSX.Element {
  const summaries = summarizeModels(turns);
  const maxCost = Math.max(...summaries.map((summary) => summary.totalCostUsd), 0);
  const recommendation = recommendModel(summaries);

  if (summaries.length === 0) {
    return <Text dimColor>No models match the current filters.</Text>;
  }

  return (
    <Box flexDirection="column">
      {summaries.map((summary) => (
        <Box key={summary.model} flexDirection="column" marginBottom={1}>
          <Text>
            {"  "}
            {summary.model.padEnd(22)}
            {`${summary.promptCount} prompts`.padEnd(15)}
            {showTokens
              ? `${formatCount(summary.inputTokens)} in   ${formatCount(summary.cachedTokens)} cached   ${formatCount(summary.outputTokens)} out   ${formatCount(summary.reasoningTokens)} reasoning`
              : `${formatUsd(summary.totalCostUsd, true)}    avg ${formatUsd(summary.avgCostUsd, true)}/prompt`}
          </Text>
          <Text dimColor>  {costBar(summary.totalCostUsd, maxCost)}</Text>
        </Box>
      ))}
      {recommendation ? <Text color="green">  {recommendation.text}</Text> : null}
    </Box>
  );
}

function StatsView({
  turns,
  pricing
}: {
  turns: readonly ParsedTurn[];
  pricing: PricingTable;
}): React.JSX.Element {
  const stats = summarizeStats(turns, pricing);
  const mostExpensiveIndex = stats.mostExpensiveTurn
    ? Math.max(0, turns.findIndex((turn) => turn.id === stats.mostExpensiveTurn?.id)) + 1
    : 0;
  const mostExpensive = stats.mostExpensiveTurn
    ? `#${mostExpensiveIndex}  ~${formatUsd(stats.mostExpensiveTurn.costUsd)}  (${stats.mostExpensiveTurn.topic ?? "untagged"})`
    : "none";

  return (
    <Box flexDirection="column">
      <Text bold>  Session Summary</Text>
      <Text dimColor>  ─────────────────────────────────────────</Text>
      <Text>  Total cost              ~{formatUsd(stats.totalCostUsd)}</Text>
      <Text>  Total prompts           {stats.totalPrompts}</Text>
      <Text>  Duration                {formatDuration(stats.durationMs)}</Text>
      <Text>  Avg cost/prompt         ~{formatUsd(stats.avgCostUsd)}</Text>
      <Text>  Most expensive prompt   {mostExpensive}</Text>
      <Text>  Cache hit rate          {formatPercent(stats.cacheHitRate)}</Text>
      <Text>  Cache savings           ~{formatUsd(stats.cacheSavingsUsd)} saved</Text>
      {stats.goal ? (
        <>
          <Text>  Goal mode              {stats.goal.status} · {formatCount(stats.goal.tokensUsed)} used{stats.goal.tokenBudget === null ? "" : ` / ${formatCount(stats.goal.tokenBudget)} budget`} · {formatDuration(stats.goal.timeUsedSeconds * 1000)}</Text>
          <Text wrap="truncate-end">  Goal objective         {stats.goal.objective || stats.goal.goalId}</Text>
        </>
      ) : null}
      <Text>  Most expensive topic    {formatTopicAverage(stats.mostExpensiveTopic)}</Text>
      <Text>  Cheapest topic          {formatTopicAverage(stats.cheapestTopic)}</Text>
      <Text dimColor>  ─────────────────────────────────────────</Text>
      <Text bold>  Top topics</Text>
      {stats.topTopics.map((topic) => (
        <Text key={topic.topic}>  {topic.topic.padEnd(16)} {`${topic.promptCount} prompts`.padEnd(12)} ~{formatUsd(topic.totalCostUsd)}</Text>
      ))}
      <Text dimColor>  ─────────────────────────────────────────</Text>
      <Text bold>  Cache Efficiency</Text>
      <Text>  Overall grade        <Text color={getCacheGradeLabel(stats.cacheEfficiency.overallGrade).color}>{stats.cacheEfficiency.overallGrade}</Text></Text>
      <Text>  Average hit rate     {formatPercent(stats.cacheEfficiency.averageHitRate)}</Text>
      <Text>  Total saved          ~{formatUsd(stats.cacheEfficiency.totalSavingsUsd)} across {stats.totalPrompts} prompts</Text>
      <Text>  Best session topic   {formatCacheTopic(stats.cacheEfficiency.bestTopic)}</Text>
      <Text>  Worst topic          {formatCacheTopic(stats.cacheEfficiency.worstTopic)}</Text>
      <Text wrap="wrap">  Tip: {stats.cacheEfficiency.tip}</Text>
    </Box>
  );
}

function FilterOverlay({
  overlay,
  availableModels,
  availableTopics
}: {
  overlay: FilterOverlayState;
  availableModels: readonly string[];
  availableTopics: readonly string[];
}): React.JSX.Element {
  const options = overlay.mode === "models" ? availableModels : availableTopics;
  const title = overlay.mode === "models" ? "Filter by model:" : "Filter by topic:";
  return (
    <Box flexDirection="column">
      <Text bold>  {title}</Text>
      {options.map((option, index) => (
        <Text key={option} color={index === overlay.cursor ? "cyan" : undefined}>
          {"  "}
          {index === overlay.cursor ? ">" : " "}
          {" "}
          [{overlay.selected.includes(option) ? "x" : " "}] {option}
        </Text>
      ))}
      {options.length === 0 ? <Text dimColor>  No filter options yet.</Text> : null}
      <Text dimColor>  ↑↓ move   space toggle   enter apply   esc cancel</Text>
    </Box>
  );
}

function formatDetection(label: string, result: StorageResult | undefined): string {
  if (!result || result.status === "missing") {
    return `  ✗  ${label.padEnd(13)} not detected         none`;
  }
  const goal = result.source === "codex" && result.goal
    ? ` · goal ${result.goal.status}`
    : "";
  return `  ✓  ${label.padEnd(13)} ${shortPath(result.pattern ?? result.path).padEnd(20)} ${result.format}${goal}`;
}

function formatTopicAverage(topic: { topic: string; avgCostUsd: number } | null): string {
  if (!topic) {
    return "none";
  }
  return `${topic.topic}  ~${formatUsd(topic.avgCostUsd)}/prompt avg`;
}

function getCostLabel(costUsd: number): { label: string; color: string | undefined; dim: boolean } {
  if (costUsd < 0.001) {
    return { label: "trivial", color: undefined, dim: true };
  }
  if (costUsd < 0.01) {
    return { label: "cheap", color: "white", dim: false };
  }
  if (costUsd < 0.05) {
    return { label: "moderate", color: "yellow", dim: false };
  }
  if (costUsd < 0.2) {
    return { label: "expensive", color: "#ffa500", dim: false };
  }
  return { label: "very expensive", color: "red", dim: false };
}

function getCacheGradeLabel(grade: ParsedTurn["cacheGrade"]): { color: string; description: string } {
  const color = grade === "A" ? "green"
    : grade === "B" ? "cyan"
      : grade === "C" ? "yellow"
        : grade === "D" ? "#ffa500"
          : "red";
  return {
    color,
    description: describeCacheGrade(grade).replace(/^[^—]+—\s*/, "").toLowerCase()
  };
}

function formatCacheTopic(topic: {
  topic: string;
  cacheHitRate: number;
  cacheGrade: ParsedTurn["cacheGrade"];
} | null): string {
  if (!topic) {
    return "none";
  }
  return `${topic.topic}   ${topic.cacheGrade}  (${formatPercent(topic.cacheHitRate)} hit rate)`;
}

function sortPromptTurns(turns: readonly ParsedTurn[], sortMode: PromptSortMode): ParsedTurn[] {
  if (sortMode === "time") {
    return [...turns];
  }
  return [...turns].sort((a, b) => (
    cacheGradeSortValue(a.cacheGrade) - cacheGradeSortValue(b.cacheGrade) ||
    a.cacheHitRate - b.cacheHitRate ||
    a.timestamp.getTime() - b.timestamp.getTime()
  ));
}

function costBar(value: number, maxValue: number): string {
  const filled = maxValue <= 0 ? 0 : Math.max(1, Math.round((value / maxValue) * BAR_WIDTH));
  return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
}

function formatTokenLine(turn: ParsedTurn): string {
  return `${formatCount(turn.inputTokens)} in   ${formatCount(turn.cachedTokens)} cached   ${formatCount(turn.outputTokens)} out   ${formatCount(turn.reasoningTokens)} reasoning`;
}

function formatCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 1)}k`;
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number, approximate = false): string {
  const prefix = approximate ? "~" : "$";
  if (approximate) {
    return `${prefix}$${value.toFixed(3)}`;
  }
  return `$${value.toFixed(value < 0.01 ? 3 : 2)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function shortPath(path: string): string {
  const home = process.env.HOME;
  const homeRelative = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  if (homeRelative.length <= 20) {
    return homeRelative;
  }
  return `${homeRelative.slice(0, 17)}...`;
}

function viewLabel(activeView: ActiveView, modelCount: number, topicCount: number): string {
  return `View: ${activeView} | active model filters: ${modelCount} | active topic filters: ${topicCount}`;
}

export function selectedFilters(
  available: readonly string[],
  unchecked: readonly string[]
): string[] {
  const uncheckedSet = new Set(unchecked);
  return available.filter((item) => !uncheckedSet.has(item));
}

export function unselectedFilters(
  available: readonly string[],
  selected: readonly string[]
): string[] {
  const selectedSet = new Set(selected);
  return available.filter((item) => !selectedSet.has(item));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
