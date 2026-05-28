// Индикатор прогресса ансамбля: показываем какие модели сейчас отвечают,
// какие уже закончили/упали, потом — что судья синтезирует финал.
//
// Рендерится во время стрима, заменяет обычный «thinking»-индикатор когда
// бэкенд начал ensemble (прилетело событие ensemble_start).

import { getModelOption } from "@/lib/chat-client";
import styles from "./EnsembleProgress.module.css";

export interface EnsembleLive {
  models: string[];
  done: string[];
  failed: string[];
  judgeStarted: boolean;
  judgeModel?: string;
}

interface Props {
  live: EnsembleLive;
}

export function EnsembleProgress({ live }: Props) {
  const { models, done, failed, judgeStarted, judgeModel } = live;
  const doneSet = new Set(done);
  const failedSet = new Set(failed);
  const totalDone = done.length + failed.length;
  const judgeOption = judgeModel ? getModelOption(judgeModel) : null;

  return (
    <div className={styles.wrap} aria-live="polite">
      <div className={styles.header}>
        <span className={styles.label}>
          {judgeStarted
            ? "Синтезирую лучшее из ответов"
            : totalDone === models.length
              ? "Все модели готовы — запускаю судью"
              : `Спрашиваю ${models.length} модели · готово ${totalDone}/${models.length}`}
        </span>
      </div>
      <div className={styles.row}>
        {models.map((m) => {
          const opt = getModelOption(m);
          const isDone = doneSet.has(m);
          const isFailed = failedSet.has(m);
          const state = isFailed ? "failed" : isDone ? "done" : "pending";
          return (
            <div key={m} className={styles.chip} data-state={state}>
              <span className={styles.dot} aria-hidden />
              <span className={styles.chipLabel}>{opt.label}</span>
            </div>
          );
        })}
        <span className={styles.arrow} aria-hidden>
          →
        </span>
        <div
          className={styles.judgeChip}
          data-state={judgeStarted ? "active" : "waiting"}
        >
          <span className={styles.judgeIcon} aria-hidden>
            ⚖
          </span>
          <span className={styles.chipLabel}>
            {judgeOption ? `Судья · ${judgeOption.label}` : "Судья"}
          </span>
        </div>
      </div>
    </div>
  );
}
