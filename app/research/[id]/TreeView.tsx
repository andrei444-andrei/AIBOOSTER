"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "@/components/ui";
import { Markdown } from "@/components/chat/Markdown";
import type {
  Direction,
  FindingRow,
  NodeRow,
  RunRow,
  SearchSource,
} from "@/lib/research/types";

interface Snapshot {
  run: RunRow;
  nodes: NodeRow[];
  findings: FindingRow[];
}

export default function TreeView({ runId, token }: { runId: string; token: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ticking, setTicking] = useState(false);
  const [tickNote, setTickNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/research/${runId}`, {
        headers: { "x-admin-token": token },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setData(json as Snapshot);
      setError(null);
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        for (const n of (json as Snapshot).nodes) {
          if (n.parent_id === null || n.depth === 0) next.add(n.id);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, token]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: поллим, пока прогон идёт.
  useEffect(() => {
    if (data?.run.status !== "running") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.run.status, load]);

  const tree = useMemo(() => buildTree(data?.nodes ?? []), [data?.nodes]);
  const selected = useMemo(
    () => (data?.nodes ?? []).find((n) => n.id === selectedId) ?? null,
    [data?.nodes, selectedId],
  );

  async function runTicks() {
    if (ticking) return;
    setTicking(true);
    setTickNote(null);
    try {
      const res = await fetch(`/api/research/tick?run=${runId}&n=12`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setTickNote(`+${json.ticks} тиков · ${json.lastNote ?? ""}`);
      await load();
    } catch (err) {
      setTickNote("ошибка: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setTicking(false);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error && !data) return <Card style={{ borderColor: "var(--danger)" }}>Ошибка: {error}</Card>;
  if (!data) return <p style={{ color: "var(--text-muted)" }}>Загрузка…</p>;

  const { run, findings } = data;

  return (
    <div>
      <a href={`/research?token=${encodeURIComponent(token)}`} style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        ← все прогоны
      </a>

      <Card style={{ marginTop: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={chip(run.status)}>{run.status}</span>
          <h1 style={{ margin: 0, fontSize: "var(--text-xl)", flex: 1 }}>{run.goal}</h1>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 8 }}>
          узлов раскрыто: {run.stats.nodesExpanded} · факторов: {run.stats.findings} · поисков:{" "}
          {run.stats.searches} · тиков: {run.stats.ticks} · стоимость: ${run.stats.costUsd.toFixed(4)}
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", marginTop: 4 }}>
          поиск: {run.params.searchProvider} · модели: {run.params.reasoningModel} / {run.params.extractModel}
          {run.params.searchProvider === "perplexity" ? ` / ${run.params.searchModel}` : ""} · бюджет:
          ≤{run.params.maxNodes} узлов, ≤${run.params.maxCostUsd}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <Button size="sm" onClick={runTicks} loading={ticking} disabled={run.status !== "running"}>
            Прокрутить (12 тиков)
          </Button>
          {run.status === "running" && (
            <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>● live · обновление каждые 3с</span>
          )}
          {tickNote && <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>{tickNote}</span>}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 480px", minWidth: 320 }}>
          <h2 style={h2}>Дерево рассуждений</h2>
          {tree.roots.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>Узлы появятся после первого тика.</p>
          ) : (
            <div style={{ fontSize: "var(--text-sm)" }}>
              {tree.roots.map((n) => (
                <TreeNode
                  key={n.id}
                  node={n}
                  childrenMap={tree.children}
                  expanded={expanded}
                  selectedId={selectedId}
                  onToggle={toggle}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          )}
        </Card>

        <Card style={{ flex: "1 1 360px", minWidth: 300 }}>
          <h2 style={h2}>Узел</h2>
          {selected ? <NodeDetail node={selected} /> : <p style={{ color: "var(--text-muted)" }}>Выберите узел в дереве.</p>}
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <h2 style={h2}>Реестр факторов ({findings.length})</h2>
        {findings.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>Пока пусто.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {findings.map((f) => (
              <FindingItem key={f.id} f={f} />
            ))}
          </div>
        )}
      </Card>

      {run.report && (
        <Card style={{ marginTop: 16 }}>
          <h2 style={h2}>Итоговый обзор</h2>
          <Markdown source={run.report} />
        </Card>
      )}
    </div>
  );
}

function TreeNode({
  node,
  childrenMap,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: NodeRow;
  childrenMap: Map<string, NodeRow[]>;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const kids = childrenMap.get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  const promise = node.scores?.promise;

  return (
    <div style={{ marginLeft: node.depth === 0 ? 0 : 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 4px",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          background: selectedId === node.id ? "var(--bg-hover)" : "transparent",
        }}
        onClick={() => onSelect(node.id)}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (kids.length) onToggle(node.id);
          }}
          style={{ width: 14, opacity: kids.length ? 0.9 : 0.25, userSelect: "none" }}
        >
          {kids.length ? (isOpen ? "▾" : "▸") : "•"}
        </span>
        <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: nodeColor(node.status), flex: "0 0 auto" }} />
        <span style={{ flex: 1, fontWeight: node.kind === "root" ? 600 : 400 }}>{trunc(node.question, 90)}</span>
        {promise != null && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>p={promise.toFixed(2)}</span>
        )}
      </div>
      {isOpen &&
        kids.map((c) => (
          <TreeNode
            key={c.id}
            node={c}
            childrenMap={childrenMap}
            expanded={expanded}
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function NodeDetail({ node }: { node: NodeRow }) {
  return (
    <div style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>{node.question}</div>
      <Row label="статус" value={node.status} />
      <Row label="тип" value={node.kind} />
      <Row label="глубина" value={String(node.depth)} />
      {node.decision && <Row label="решение" value={node.decision} />}
      <Row label="стоимость" value={`$${node.cost_usd.toFixed(4)}`} />

      {node.scores && (
        <div style={{ margin: "10px 0" }}>
          <Bar label="релевантность" v={node.scores.relevance} />
          <Bar label="новизна" v={node.scores.novelty} />
          <Bar label="доказательства" v={node.scores.evidence} />
          <Bar label="перспективность" v={node.scores.promise} />
        </div>
      )}

      {node.rationale && (
        <div style={{ marginTop: 8 }}>
          <div style={lbl}>обоснование решения</div>
          <div>{node.rationale}</div>
        </div>
      )}
      {node.summary && (
        <div style={{ marginTop: 8 }}>
          <div style={lbl}>выжимка</div>
          <div>{node.summary}</div>
        </div>
      )}
      {node.sources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={lbl}>источники ({node.sources.length})</div>
          <SourceList sources={node.sources} />
        </div>
      )}
    </div>
  );
}

function FindingItem({ f }: { f: FindingRow }) {
  return (
    <details style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "6px 10px" }}>
      <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={dirChip(f.direction)}>{f.direction}</span>
        <span style={{ fontWeight: 600 }}>{f.factor}</span>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
          conf {f.confidence.toFixed(2)} · упоминаний {f.mentions} · источников {f.sources.length}
        </span>
      </summary>
      <div style={{ fontSize: "var(--text-sm)", marginTop: 6, lineHeight: 1.5 }}>
        {f.description && <div>{f.description}</div>}
        {f.evidence.length > 0 && (
          <ul style={{ margin: "6px 0", paddingLeft: 18, color: "var(--text-secondary)" }}>
            {f.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {f.sources.length > 0 && <SourceList sources={f.sources} />}
      </div>
    </details>
  );
}

function SourceList({ sources }: { sources: SearchSource[] }) {
  return (
    <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
      {sources.map((s, i) => (
        <li key={i} style={{ marginBottom: 2 }}>
          <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
            {trunc(s.title || s.url, 80)}
          </a>
          {s.date && <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}> · {s.date}</span>}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ ...lbl, width: 110 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "3px 0" }}>
      <span style={{ ...lbl, width: 110 }}>{label}</span>
      <span style={{ flex: 1, height: 6, background: "var(--bg-muted)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
        <span style={{ display: "block", width: `${Math.round(v * 100)}%`, height: "100%", background: "var(--accent)" }} />
      </span>
      <span style={{ width: 34, textAlign: "right", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{v.toFixed(2)}</span>
    </div>
  );
}

function buildTree(nodes: NodeRow[]): { roots: NodeRow[]; children: Map<string, NodeRow[]> } {
  const children = new Map<string, NodeRow[]>();
  const roots: NodeRow[] = [];
  for (const n of nodes) {
    if (n.parent_id === null) roots.push(n);
    else {
      const arr = children.get(n.parent_id) ?? [];
      arr.push(n);
      children.set(n.parent_id, arr);
    }
  }
  return { roots, children };
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function nodeColor(status: string): string {
  const m: Record<string, string> = {
    open: "var(--text-muted)",
    searching: "var(--warning)",
    expanded: "var(--success)",
    exhausted: "var(--border-strong)",
    error: "var(--danger)",
  };
  return m[status] ?? "var(--text-muted)";
}

function chip(status: string): React.CSSProperties {
  const map: Record<string, { c: string; b: string }> = {
    running: { c: "var(--info)", b: "var(--info-bg)" },
    done: { c: "var(--success)", b: "var(--success-bg)" },
    error: { c: "var(--danger)", b: "var(--danger-bg)" },
    pending: { c: "var(--text-muted)", b: "var(--bg-subtle)" },
  };
  const s = map[status] ?? map.pending;
  return { background: s.b, color: s.c, fontSize: "var(--text-xs)", padding: "2px 10px", borderRadius: "var(--radius-full)" };
}

function dirChip(d: Direction): React.CSSProperties {
  const map: Record<Direction, { c: string; b: string }> = {
    positive: { c: "var(--success)", b: "var(--success-bg)" },
    negative: { c: "var(--danger)", b: "var(--danger-bg)" },
    mixed: { c: "var(--warning)", b: "var(--warning-bg)" },
    unclear: { c: "var(--text-muted)", b: "var(--bg-subtle)" },
  };
  const s = map[d] ?? map.unclear;
  return { background: s.b, color: s.c, fontSize: "var(--text-xs)", padding: "1px 7px", borderRadius: "var(--radius-full)" };
}

const h2: React.CSSProperties = { marginTop: 0, fontSize: "var(--text-md)" };
const lbl: React.CSSProperties = { color: "var(--text-muted)", fontSize: "var(--text-xs)" };
