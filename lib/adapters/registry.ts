// Регистрация конкретных адаптеров.
//
// Каждый адаптер добавляется одной строкой ниже. Движок (tick / runner)
// смотрит kind у источника и берёт адаптер отсюда.

import type { Adapter, AdapterKind } from "./types";
import { GmailAdapter } from "./gmail";

const REGISTRY: Partial<Record<AdapterKind, Adapter>> = {
  gmail: GmailAdapter as unknown as Adapter,
  // notion, slack, telegram, gcal — будут добавлены здесь по мере появления.
};

export function getAdapter(kind: AdapterKind): Adapter | null {
  return REGISTRY[kind] ?? null;
}
