// Коллапсибл «Что ответили модели» под финальным ответом ассистента.
// Открывается по клику, показывает табы по каждому кандидату + ответ судьи.
//
// Рендерится только если route_meta.ensemble === true.

import { useState } from "react";
import { getModelOption } from "@/lib/chat-client";
import { Markdown } from "./Markdown";
import styles from "./EnsembleCandidates.module.css";

export interface EnsembleCandidate {
  model: string;
  duration_ms: number;
  tokens?: number;
  response: string;
  error?: string | null;
}

export interface EnsembleJudge {
  model: string;
  duration_ms: number;
  tokens?: number;
}

interface Props {
  candidates: EnsembleCandidate[];
  judge: EnsembleJudge;
  totalDurationMs?: number;
}

export function EnsembleCandidates({ candidates, judge, totalDurationMs }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  if (candidates.length === 0) return null;

  const active = candidates[Math.min(activeIdx, candidates.length - 1)];
  const judgeOption = getModelOption(judge.model);
  const aliveCount = candidates.filter((c) => !c.error).length;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.toggleIcon} aria-hidden>
          ⚖
        </span>
        <span className={styles.toggleLabel}>
          {open ? "Скрыть кандидатов" : `Синтезировано из ${aliveCount} моделей`}
        </span>
        <span className={styles.toggleMeta}>
          судья: {judgeOption.label}
          {totalDurationMs ? ` · ${formatMs(totalDurationMs)}` : ""}
        </span>
        <span className={styles.toggleChevron} data-open={open} aria-hidden>
          ⌃
        </span>
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.tabs} role="tablist">
            {candidates.map((c, i) => {
              const opt = getModelOption(c.model);
              const isActive = i === activeIdx;
              return (
                <button
                  key={c.model + i}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={styles.tab}
                  data-active={isActive}
                  data-failed={c.error ? true : undefined}
                  onClick={() => setActiveIdx(i)}
                >
                  <span className={styles.tabLabel}>{opt.label}</span>
                  {!c.error && (
                    <span className={styles.tabMeta}>{formatMs(c.duration_ms)}</span>
                  )}
                  {c.error && <span className={styles.tabFailed}>упал</span>}
                </button>
              );
            })}
          </div>

          <div className={styles.body}>
            <div className={styles.bodyMeta}>
              <span>{getModelOption(active.model).vendor}</span>
              <span className={styles.bodyMetaDot}>·</span>
              <span>{formatMs(active.duration_ms)}</span>
              {active.tokens != null && (
                <>
                  <span className={styles.bodyMetaDot}>·</span>
                  <span>{active.tokens} токенов</span>
                </>
              )}
            </div>
            {active.error ? (
              <div className={styles.errorMsg}>
                Кандидат упал: {active.error}. Судья работал без него.
              </div>
            ) : (
              <div className={styles.candidateBody}>
                <Markdown source={active.response} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} с`;
  return `${Math.round(s)} с`;
}
