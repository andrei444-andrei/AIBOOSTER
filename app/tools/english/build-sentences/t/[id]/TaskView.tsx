"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import styles from "../../build.module.css";

interface Chunk {
  text: string;
  tr: string;
}
interface Item {
  idx: number;
  en: string;
  ru: string | null;
  chunks: Chunk[];
  memo: string | null;
  completed: number;
}
interface TaskDto {
  id: string;
  topic: string;
  title: string | null;
  status: "generating" | "ready" | "failed";
  error_message: string | null;
  error_id: string | null;
  total: number;
  done: number;
}
interface ApiResponse {
  task: TaskDto;
  items: Item[];
}

export default function TaskView({ taskId }: { taskId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const res = await fetch(`/api/english-sentences/${taskId}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setFetchError(body.error || `ошибка ${res.status}`);
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setData(json);
        setFetchError(null);
        setCompleted(new Set(json.items.filter((i) => i.completed).map((i) => i.idx)));
        if (json.task.status === "generating") timer = setTimeout(tick, 2000);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(tick, 4000);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  async function onComplete(idx: number) {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    try {
      await fetch(`/api/english-sentences/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed_idx: idx }),
        keepalive: true,
      });
    } catch {
      // не критично — отметка сохранится при следующем успехе
    }
  }

  if (!data && !fetchError) {
    return (
      <Card padded style={{ marginTop: 24 }}>
        <span style={{ color: "var(--text-secondary)" }}>Загружаем задание…</span>
      </Card>
    );
  }
  if (fetchError && !data) {
    return (
      <Card padded style={{ marginTop: 24, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
        <span style={{ color: "var(--danger)" }}>Не удалось загрузить: {fetchError}</span>
      </Card>
    );
  }
  if (!data) return null;
  const { task, items } = data;

  if (task.status === "generating") {
    return (
      <Card padded style={{ marginTop: 24 }}>
        <div style={{ color: "var(--text-secondary)" }}>Генерируем 10 предложений по теме…</div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          Обычно занимает 15–25 секунд. Можно подождать здесь.
        </div>
      </Card>
    );
  }
  if (task.status === "failed") {
    return (
      <Card padded style={{ marginTop: 24, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
        <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>Не удалось сгенерировать</div>
        <div style={{ color: "var(--text)" }}>{task.error_message || "неизвестная ошибка"}</div>
        <Link href="/tools/english/build-sentences" style={{ display: "inline-block", marginTop: 14 }}>
          <Button variant="primary">Попробовать снова</Button>
        </Link>
      </Card>
    );
  }

  const total = items.length;
  const doneCount = completed.size;
  const allDone = total > 0 && doneCount >= total;

  return (
    <div>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.01em", margin: "20px 0 4px" }}>
        {task.title || "Build sentences"}
      </h1>
      <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", marginBottom: 4 }}>{task.topic}</div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 6 }}>
        Собрано <strong style={{ color: "var(--text)" }}>{doneCount}</strong> / {total}
      </div>
      <div style={{ height: 6, background: "var(--bg-subtle)", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ width: `${total ? (doneCount / total) * 100 : 0}%`, height: "100%", background: "var(--accent)", transition: "width 300ms var(--ease)" }} />
      </div>

      {allDone && (
        <Card padded style={{ marginBottom: 16, borderColor: "var(--success)", background: "var(--success-bg)" }}>
          <div style={{ color: "var(--success)", fontWeight: 600 }}>🎉 Задание выполнено!</div>
          <div style={{ color: "var(--text)", fontSize: "var(--text-sm)", marginTop: 4 }}>
            Оно переехало в раздел «Сделано».
          </div>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {items.map((it) => (
          <SentenceExercise
            key={it.idx}
            item={it}
            done={completed.has(it.idx)}
            onComplete={() => onComplete(it.idx)}
          />
        ))}
      </div>
    </div>
  );
}

function shuffleOrder(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return arr;
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.some((v, i) => v !== i)) break; // не оставляем уже-правильный порядок
  }
  return arr;
}

function SentenceExercise({
  item,
  done,
  onComplete,
}: {
  item: Item;
  done: boolean;
  onComplete: () => void;
}) {
  const chunks = item.chunks;
  const [order, setOrder] = useState<number[]>(() => shuffleOrder(chunks.length));
  const [status, setStatus] = useState<"idle" | "wrong" | "correct">(done ? "correct" : "idle");
  const [trShown, setTrShown] = useState<number | null>(null);
  const [draggingChunk, setDraggingChunk] = useState<number | null>(null);
  const dragRef = useRef<{ from: number; moved: boolean; x: number; y: number } | null>(null);

  const solved = status === "correct" || done;

  function pointerDown(e: React.PointerEvent, pos: number) {
    if (solved) return;
    dragRef.current = { from: pos, moved: false, x: e.clientX, y: e.clientY };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  function pointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.moved = true;
      setDraggingChunk(order[d.from]);
      setTrShown(null);
    }
    if (!d.moved) return;
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
      "[data-pos]",
    ) as HTMLElement | null;
    if (!el) return;
    const to = Number(el.dataset.pos);
    if (Number.isNaN(to) || to === d.from) return;
    setOrder((prev) => {
      const a = [...prev];
      const [m] = a.splice(d.from, 1);
      a.splice(to, 0, m);
      return a;
    });
    d.from = to;
  }
  function pointerUp(e: React.PointerEvent, pos: number) {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingChunk(null);
    if (!d) return;
    if (!d.moved) {
      // тап без перемещения → показать перевод куска
      const chunkIndex = order[pos];
      setTrShown((prev) => (prev === chunkIndex ? null : chunkIndex));
      return;
    }
    // после перетаскивания сбрасываем статус проверки
    if (status !== "idle") setStatus("idle");
  }

  function check() {
    const userSeq = order.map((i) => chunks[i].text).join("");
    const correctSeq = chunks.map((c) => c.text).join("");
    if (userSeq === correctSeq) {
      setStatus("correct");
      setTrShown(null);
      if (!done) onComplete();
    } else {
      setStatus("wrong");
    }
  }

  function reshuffle() {
    setOrder(shuffleOrder(chunks.length));
    setStatus("idle");
    setTrShown(null);
  }

  return (
    <Card padded>
      {item.ru && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 2 }}>
          {item.ru}
        </div>
      )}

      {solved ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
          <span style={{ color: "var(--success)" }}>✓</span>
          <span style={{ fontSize: "var(--text-md)", color: "var(--text)" }}>{item.en}</span>
        </div>
      ) : (
        <>
          <div className={styles.tiles}>
            {order.map((chunkIndex, pos) => {
              const c = chunks[chunkIndex];
              const isDragging = draggingChunk === chunkIndex;
              return (
                <span
                  key={chunkIndex}
                  data-pos={pos}
                  className={`${styles.tile} ${isDragging ? styles.tileDragging : ""} ${status === "wrong" ? styles.tileWrong : ""}`}
                  onPointerDown={(e) => pointerDown(e, pos)}
                  onPointerMove={pointerMove}
                  onPointerUp={(e) => pointerUp(e, pos)}
                >
                  {c.text}
                  {trShown === chunkIndex && (
                    <span
                      style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        zIndex: 5,
                        whiteSpace: "nowrap",
                        background: "var(--text)",
                        color: "var(--bg)",
                        fontSize: 12,
                        padding: "3px 7px",
                        borderRadius: "var(--radius-sm)",
                        boxShadow: "var(--shadow)",
                      }}
                    >
                      {c.tr || "—"}
                    </span>
                  )}
                </span>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button size="sm" variant="primary" onClick={check}>
              Проверить
            </Button>
            <Button size="sm" variant="ghost" onClick={reshuffle}>
              Перемешать
            </Button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              перетащи куски по порядку · тапни по куску — перевод
            </span>
          </div>

          {status === "wrong" && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                color: "var(--text)",
                lineHeight: "var(--leading-normal)",
              }}
            >
              <span style={{ color: "var(--danger)", fontWeight: 600 }}>Пока не так. </span>
              {item.memo || "Проверь порядок слов и попробуй ещё раз."}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
