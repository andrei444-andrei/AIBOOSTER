"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAMPAIGNS,
  FAVORITES,
  NETWORKS,
  generateVariants,
  imgUrl,
  searchImages,
  seedGradient,
  type Asset,
  type Campaign,
  type Format,
  type Network,
  type TextReq,
} from "./data";
import {
  IcArrowLeft,
  IcArrowRight,
  IcBell,
  IcCheck,
  IcChevronDown,
  IcClock,
  IcClose,
  IcCrop,
  IcDoc,
  IcGrip,
  IcHeart,
  IcHome,
  IcImage,
  IcLayers,
  IcMegaphone,
  IcPlus,
  IcScript,
  IcSearch,
  IcSparkle,
  IcTerminal,
  IcWand,
  IcZoom,
} from "./icons";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

type Crop = { zoom: number; px: number; py: number };
type Creative = Asset & {
  crops: Record<string, Crop>;
  assigned: Record<string, string>;
};
const DEFAULT_CROP: Crop = { zoom: 1, px: 0, py: 0 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// CSS custom properties aren't part of React.CSSProperties — cast through it.
const netVar = (color?: string): React.CSSProperties =>
  ({ "--net": color ?? "#6d5dfc" }) as React.CSSProperties;

const STEPS = [
  { id: 0, label: "Кампания", icon: IcMegaphone },
  { id: 1, label: "Фото", icon: IcImage },
  { id: 2, label: "Ресайз", icon: IcCrop },
  { id: 3, label: "Тексты", icon: IcSparkle },
  { id: 4, label: "Готово", icon: IcCheck },
];

const SUGGESTIONS = ["кроссовки", "часы", "куртка", "смартфон", "кофе", "авто"];

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

export default function AdStudio() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const [campaignId, setCampaignId] = useState<string>("");
  const [networkId, setNetworkId] = useState<string>("");

  const [tab, setTab] = useState<"fav" | "search">("fav");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[]>([]);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<Creative[]>([]);
  const [activeFormat, setActiveFormat] = useState<string>("");

  const [master, setMaster] = useState<Record<string, string>>({});
  const [pool, setPool] = useState<Record<string, string[]>>({});

  const campaign = useMemo(() => CAMPAIGNS.find((c) => c.id === campaignId), [campaignId]);
  const network = useMemo(() => NETWORKS.find((n) => n.id === networkId), [networkId]);
  const primaryFormat = network?.formats[0];
  const adsCount = network ? selected.length * network.formats.length : 0;

  useEffect(() => {
    if (network && !network.formats.some((f) => f.id === activeFormat)) {
      setActiveFormat(network.formats[0]?.id ?? "");
    }
  }, [network, activeFormat]);

  /* -- selection helpers -- */
  const isSelected = (id: string) => selected.some((c) => c.id === id);
  function toggle(a: Asset) {
    setSelected((prev) =>
      prev.some((c) => c.id === a.id)
        ? prev.filter((c) => c.id !== a.id)
        : [...prev, { ...a, crops: {}, assigned: {} }],
    );
  }
  function patchCreative(id: string, patch: Partial<Creative>) {
    setSelected((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function setCrop(id: string, fmt: string, crop: Crop) {
    setSelected((prev) =>
      prev.map((c) => (c.id === id ? { ...c, crops: { ...c.crops, [fmt]: crop } } : c)),
    );
  }
  function assign(id: string, key: string, value: string) {
    setSelected((prev) =>
      prev.map((c) => (c.id === id ? { ...c, assigned: { ...c.assigned, [key]: value } } : c)),
    );
  }
  function assignAll(key: string, value: string) {
    setSelected((prev) => prev.map((c) => ({ ...c, assigned: { ...c.assigned, [key]: value } })));
  }

  /* -- search -- */
  function doSearch(q?: string) {
    const term = (q ?? query).trim();
    setQuery(term);
    setSearching(true);
    setResults([]);
    window.setTimeout(() => {
      setResults(searchImages(term));
      setSearching(false);
    }, 500);
  }

  /* -- campaign pick -- */
  function pickCampaign(c: Campaign) {
    setCampaignId(c.id);
    setNetworkId(c.net);
  }

  /* -- validation -- */
  const canNext =
    (step === 0 && !!campaign && !!network) ||
    (step === 1 && selected.length > 0) ||
    step === 2 ||
    step === 3;

  function next() {
    if (step < 4) setStep(step + 1);
  }
  function back() {
    if (step > 0) setStep(step - 1);
  }
  function reset() {
    setStep(0);
    setDone(false);
    setCampaignId("");
    setNetworkId("");
    setSelected([]);
    setTab("fav");
    setQuery("");
    setResults([]);
    setMaster({});
    setPool({});
  }

  return (
    <div className="ads-root">
      <style>{CSS}</style>
      <Sidebar />
      <div className="ads-main">
        <Topbar />
        <div className="ads-content">
          <div className="ads-pagehead">
            <div>
              <h1 className="ads-h1">Создание объявления</h1>
              <p className="ads-sub">
                Соберите пачку креативов за минуту: фото → ресайз → тексты → запуск.
              </p>
            </div>
            {campaign && network && (
              <div className="ads-crumbs">
                <span className="ads-crumb">
                  <IcMegaphone size={14} /> {campaign.name}
                </span>
                <span className="ads-crumb" style={netVar(network.color)}>
                  <span className="ads-dot" /> {network.name}
                </span>
                {selected.length > 0 && (
                  <span className="ads-crumb ads-crumb-accent">
                    <IcImage size={14} /> {selected.length} фото · {adsCount} объявл.
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="ads-card">
            {!done && <Stepper step={step} setStep={setStep} maxReached={selected.length > 0 ? 4 : campaign ? 1 : 0} />}

            <div className="ads-body">
              {done ? (
                <Success network={network!} count={adsCount} onMore={reset} />
              ) : step === 0 ? (
                <StepCampaign
                  campaign={campaign}
                  network={network}
                  onPick={pickCampaign}
                  onNetwork={setNetworkId}
                  selectedCount={selected.length}
                />
              ) : step === 1 ? (
                <StepPhotos
                  tab={tab}
                  setTab={setTab}
                  query={query}
                  setQuery={setQuery}
                  results={results}
                  searching={searching}
                  doSearch={doSearch}
                  selected={selected}
                  isSelected={isSelected}
                  toggle={toggle}
                />
              ) : step === 2 ? (
                <StepResize
                  network={network!}
                  selected={selected}
                  activeFormat={activeFormat}
                  setActiveFormat={setActiveFormat}
                  setCrop={setCrop}
                  setSelected={setSelected}
                />
              ) : step === 3 ? (
                <StepTexts
                  network={network!}
                  primaryFormat={primaryFormat!}
                  selected={selected}
                  master={master}
                  setMaster={setMaster}
                  pool={pool}
                  setPool={setPool}
                  assign={assign}
                  assignAll={assignAll}
                />
              ) : (
                <StepReview
                  network={network!}
                  primaryFormat={primaryFormat!}
                  campaign={campaign!}
                  selected={selected}
                  count={adsCount}
                />
              )}
            </div>

            {!done && (
              <div className="ads-footer">
                <div className="ads-footer-meta">
                  {step === 1 && (
                    <span>
                      Выбрано <b>{selected.length}</b>
                    </span>
                  )}
                  {step >= 2 && network && (
                    <span>
                      <b>{adsCount}</b> объявлений · {network.formats.length} формата
                    </span>
                  )}
                </div>
                <div className="ads-footer-actions">
                  {step > 0 && (
                    <button className="ads-btn ghost" onClick={back}>
                      <IcArrowLeft size={16} /> Назад
                    </button>
                  )}
                  {step < 4 ? (
                    <button className="ads-btn primary" disabled={!canNext} onClick={next}>
                      Далее <IcArrowRight size={16} />
                    </button>
                  ) : (
                    <button className="ads-btn primary lg" onClick={() => setDone(true)}>
                      <IcCheck size={18} /> Создать {adsCount} объявлений
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell: sidebar + topbar                                             */
/* ------------------------------------------------------------------ */

type MenuItem = { label: string; icon: typeof IcHome; active?: boolean };
const MENU: MenuItem[] = [
  { label: "Дашборд", icon: IcHome },
  { label: "Скрипты", icon: IcScript },
  { label: "Объявления", icon: IcMegaphone, active: true },
  { label: "Песочница", icon: IcTerminal },
  { label: "Уведомления", icon: IcBell },
  { label: "Расписания", icon: IcClock },
  { label: "Документация", icon: IcDoc },
];

function Sidebar() {
  return (
    <aside className="ads-side">
      <div className="ads-logo">
        <div className="ads-logo-badge">PS</div>
        <span className="ads-logo-text">Price Smart</span>
      </div>
      <div className="ads-menu-label">Меню</div>
      <nav className="ads-nav">
        {MENU.map((m) => (
          <div key={m.label} className={`ads-nav-item${m.active ? " active" : ""}`}>
            <m.icon size={19} />
            <span>{m.label}</span>
          </div>
        ))}
      </nav>
      <div className="ads-side-user">
        <div className="ads-avatar sm">D</div>
        <div>
          <div className="ads-side-user-mail">den15@bk.ru</div>
          <div className="ads-side-user-role">Полный доступ</div>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <header className="ads-top">
      <div className="ads-topsearch">
        <IcSearch size={18} />
        <input placeholder="Поиск…" />
      </div>
      <div className="ads-topright">
        <button className="ads-icon-btn">
          <IcBell size={20} />
        </button>
        <span className="ads-pill-all">ALL</span>
        <span className="ads-top-mail">den15@bk.ru</span>
        <div className="ads-avatar">D</div>
        <button className="ads-btn ghost sm">Выйти</button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

function Stepper({
  step,
  setStep,
  maxReached,
}: {
  step: number;
  setStep: (n: number) => void;
  maxReached: number;
}) {
  return (
    <div className="ads-stepper">
      {STEPS.map((s, i) => {
        const state = i < step ? "done" : i === step ? "active" : "todo";
        const reachable = i <= Math.max(step, maxReached);
        return (
          <div key={s.id} className="ads-step-wrap">
            <button
              className={`ads-step ${state}${reachable ? "" : " locked"}`}
              onClick={() => reachable && setStep(i)}
              disabled={!reachable}
            >
              <span className="ads-step-dot">
                {state === "done" ? <IcCheck size={16} /> : <s.icon size={16} />}
              </span>
              <span className="ads-step-label">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`ads-step-line${i < step ? " fill" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 0 — Campaign                                                   */
/* ------------------------------------------------------------------ */

function StepCampaign({
  campaign,
  network,
  onPick,
  onNetwork,
  selectedCount,
}: {
  campaign?: Campaign;
  network?: Network;
  onPick: (c: Campaign) => void;
  onNetwork: (id: string) => void;
  selectedCount: number;
}) {
  return (
    <div className="ads-step-pad ads-fade">
      <SectionTitle n={1} title="Выберите рекламную кампанию" hint="Объявления добавятся в неё" />
      <CampaignDropdown campaign={campaign} onPick={onPick} />

      {network && (
        <div className="ads-net-block ads-fade">
          <SectionTitle
            n={2}
            title="Рекламная сеть"
            hint="Определяет форматы и лимиты текстов — настроим автоматически"
          />
          <div className="ads-net-pills">
            {NETWORKS.map((nw) => (
              <button
                key={nw.id}
                className={`ads-net-pill${nw.id === network.id ? " active" : ""}`}
                style={netVar(nw.color)}
                onClick={() => onNetwork(nw.id)}
              >
                <span className="ads-net-badge">{nw.short}</span>
                {nw.name}
              </button>
            ))}
          </div>

          <div className="ads-net-specs">
            <div className="ads-spec">
              <div className="ads-spec-h">
                <IcCrop size={15} /> Форматы ({network.formats.length})
              </div>
              <div className="ads-spec-chips">
                {network.formats.map((f) => (
                  <span key={f.id} className="ads-chip-static">
                    {f.label}
                    <i>
                      {f.w}×{f.h}
                    </i>
                  </span>
                ))}
              </div>
            </div>
            <div className="ads-spec">
              <div className="ads-spec-h">
                <IcSparkle size={15} /> Тексты ({network.texts.length})
              </div>
              <div className="ads-spec-chips">
                {network.texts.map((t) => (
                  <span key={t.key} className="ads-chip-static">
                    {t.label}
                    <i>≤ {t.max}</i>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="ads-readybar">
            <IcCheck size={16} />
            Готово к работе. Каждое фото превратится в {network.formats.length} объявления{" "}
            {selectedCount > 0 ? `— итого ${selectedCount * network.formats.length}.` : "."} Нажмите{" "}
            <b>Далее</b>.
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignDropdown({
  campaign,
  onPick,
}: {
  campaign?: Campaign;
  onPick: (c: Campaign) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const netOf = (id: string) => NETWORKS.find((n) => n.id === id);
  return (
    <div className="ads-dd" ref={ref}>
      <button className={`ads-dd-trigger${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {campaign ? (
          <span className="ads-dd-current">
            <span className="ads-net-badge" style={netVar(netOf(campaign.net)?.color)}>
              {netOf(campaign.net)?.short}
            </span>
            <span className="ads-dd-name">{campaign.name}</span>
            <span className="ads-tag">{campaign.geo}</span>
          </span>
        ) : (
          <span className="ads-dd-placeholder">
            <IcMegaphone size={18} /> Выберите кампанию…
          </span>
        )}
        <IcChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="ads-dd-panel ads-pop">
          {CAMPAIGNS.map((c) => {
            const nw = netOf(c.net);
            return (
              <button
                key={c.id}
                className={`ads-dd-opt${campaign?.id === c.id ? " sel" : ""}`}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
              >
                <span className="ads-net-badge" style={netVar(nw?.color)}>
                  {nw?.short}
                </span>
                <span className="ads-dd-name">{c.name}</span>
                <span className={`ads-status ${c.status}`}>
                  {c.status === "active" ? "активна" : c.status === "draft" ? "черновик" : "пауза"}
                </span>
                <span className="ads-tag">{c.geo}</span>
                {campaign?.id === c.id && <IcCheck size={16} style={{ color: "var(--violet)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Photos                                                     */
/* ------------------------------------------------------------------ */

function StepPhotos({
  tab,
  setTab,
  query,
  setQuery,
  results,
  searching,
  doSearch,
  selected,
  isSelected,
  toggle,
}: {
  tab: "fav" | "search";
  setTab: (t: "fav" | "search") => void;
  query: string;
  setQuery: (s: string) => void;
  results: Asset[];
  searching: boolean;
  doSearch: (q?: string) => void;
  selected: Creative[];
  isSelected: (id: string) => boolean;
  toggle: (a: Asset) => void;
}) {
  const grid = tab === "fav" ? FAVORITES : results;
  return (
    <div className="ads-photos ads-fade">
      <div className="ads-photos-main">
        <div className="ads-seg">
          <button className={tab === "fav" ? "on" : ""} onClick={() => setTab("fav")}>
            <IcHeart size={16} /> Избранное
          </button>
          <button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>
            <IcSearch size={16} /> Поиск · Google Картинки
          </button>
        </div>

        {tab === "search" && (
          <div className="ads-searchrow">
            <div className="ads-searchbox">
              <IcSearch size={18} />
              <input
                value={query}
                placeholder="Что ищем? напр. «кроссовки nike»"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                autoFocus
              />
            </div>
            <button className="ads-btn primary" onClick={() => doSearch()}>
              Найти
            </button>
          </div>
        )}

        {tab === "search" && !searching && results.length === 0 && (
          <div className="ads-empty">
            <div className="ads-empty-ic">
              <IcSearch size={28} />
            </div>
            <p>Введите запрос — найдём картинки прямо из Google.</p>
            <div className="ads-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => doSearch(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ads-grid">
          {searching &&
            Array.from({ length: 8 }).map((_, i) => <div key={i} className="ads-tile skeleton" />)}
          {!searching &&
            grid.map((a) => (
              <button
                key={a.id}
                className={`ads-tile${isSelected(a.id) ? " sel" : ""}`}
                onClick={() => toggle(a)}
                title={a.title}
              >
                <Thumb seed={a.seed} />
                {tab === "fav" && (
                  <span className="ads-tile-heart">
                    <IcHeart size={13} />
                  </span>
                )}
                <span className="ads-tile-cap">
                  <b>{a.title}</b>
                  <i>{a.source}</i>
                </span>
                <span className="ads-tile-check">
                  <IcCheck size={15} />
                </span>
              </button>
            ))}
        </div>
      </div>

      <aside className="ads-tray">
        <div className="ads-tray-head">
          <IcLayers size={16} /> Выбранные
          <span className="ads-count">{selected.length}</span>
        </div>
        {selected.length === 0 ? (
          <div className="ads-tray-empty">
            Кликайте по фото — они появятся здесь. Выбирайте сразу пачку.
          </div>
        ) : (
          <div className="ads-tray-list">
            {selected.map((c) => (
              <div key={c.id} className="ads-tray-item">
                <Thumb seed={c.seed} />
                <span className="ads-tray-name">{c.title}</span>
                <button className="ads-tray-x" onClick={() => toggle(c)}>
                  <IcClose size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Resize / crop                                              */
/* ------------------------------------------------------------------ */

function StepResize({
  network,
  selected,
  activeFormat,
  setActiveFormat,
  setCrop,
  setSelected,
}: {
  network: Network;
  selected: Creative[];
  activeFormat: string;
  setActiveFormat: (id: string) => void;
  setCrop: (id: string, fmt: string, crop: Crop) => void;
  setSelected: React.Dispatch<React.SetStateAction<Creative[]>>;
}) {
  const fmt = network.formats.find((f) => f.id === activeFormat) ?? network.formats[0];

  function autoAll() {
    setSelected((prev) =>
      prev.map((c) => ({
        ...c,
        crops: Object.fromEntries(network.formats.map((f) => [f.id, { ...DEFAULT_CROP }])),
      })),
    );
  }
  function applyToAll(from: Creative) {
    const crop = from.crops[fmt.id] ?? DEFAULT_CROP;
    setSelected((prev) =>
      prev.map((c) => ({ ...c, crops: { ...c.crops, [fmt.id]: { ...crop } } })),
    );
  }

  return (
    <div className="ads-step-pad ads-fade">
      <div className="ads-resize-head">
        <SectionTitle title="Кадрируйте под форматы сети" hint="Тяните фото, колесо — зум. По умолчанию уже по центру." />
        <button className="ads-btn soft" onClick={autoAll}>
          <IcWand size={16} /> Авто-кадрировать всё
        </button>
      </div>

      <div className="ads-fmt-tabs">
        {network.formats.map((f) => (
          <button
            key={f.id}
            className={`ads-fmt-tab${f.id === fmt.id ? " on" : ""}`}
            onClick={() => setActiveFormat(f.id)}
          >
            <span className="ads-fmt-mini" style={{ aspectRatio: `${f.w} / ${f.h}` }} />
            {f.label}
          </button>
        ))}
      </div>

      <div className="ads-resize-grid">
        {selected.map((c) => {
          const crop = c.crops[fmt.id] ?? DEFAULT_CROP;
          return (
            <div key={c.id} className="ads-resize-card">
              <div className="ads-resize-name">{c.title}</div>
              <CropFrame
                seed={c.seed}
                format={fmt}
                crop={crop}
                onChange={(nc) => setCrop(c.id, fmt.id, nc)}
              />
              <div className="ads-crop-tools">
                <IcZoom size={15} />
                <input
                  type="range"
                  min={1}
                  max={2.6}
                  step={0.02}
                  value={crop.zoom}
                  onChange={(e) =>
                    setCrop(c.id, fmt.id, { ...crop, zoom: parseFloat(e.target.value) })
                  }
                />
                <button
                  className="ads-mini-btn"
                  title="По центру"
                  onClick={() => setCrop(c.id, fmt.id, { ...DEFAULT_CROP })}
                >
                  Авто
                </button>
                <button
                  className="ads-mini-btn"
                  title="Применить кадрирование ко всем фото"
                  onClick={() => applyToAll(c)}
                >
                  Ко всем
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CropFrame({
  seed,
  format,
  crop,
  onChange,
  interactive = true,
}: {
  seed: string;
  format: Format;
  crop: Crop;
  onChange: (c: Crop) => void;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function onPointerDown(e: React.PointerEvent) {
    if (!interactive) return;
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    const w = rect?.width || 300;
    const h = rect?.height || 300;
    const sx = crop.px;
    const sy = crop.py;
    const startX = e.clientX;
    const startY = e.clientY;
    const lim = (crop.zoom - 1) * 50 + 6;
    function move(ev: PointerEvent) {
      const dx = ((ev.clientX - startX) / w) * 100;
      const dy = ((ev.clientY - startY) / h) * 100;
      onChange({ ...crop, px: clamp(sx + dx, -lim, lim), py: clamp(sy + dy, -lim, lim) });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <div
      ref={ref}
      className={`ads-crop${interactive ? " grab" : ""}`}
      style={{ aspectRatio: `${format.w} / ${format.h}` }}
      onPointerDown={onPointerDown}
    >
      <div className="ads-crop-fallback" style={{ background: seedGradient(seed) }} />
      <img
        src={imgUrl(seed, 800)}
        alt=""
        draggable={false}
        className="ads-crop-img"
        style={{ transform: `translate(${crop.px}%, ${crop.py}%) scale(${crop.zoom})` }}
        onError={(e) => (e.currentTarget.style.opacity = "0")}
      />
      {interactive && <div className="ads-crop-rule" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Texts + AI + drag-assign                                   */
/* ------------------------------------------------------------------ */

function StepTexts({
  network,
  primaryFormat,
  selected,
  master,
  setMaster,
  pool,
  setPool,
  assign,
  assignAll,
}: {
  network: Network;
  primaryFormat: Format;
  selected: Creative[];
  master: Record<string, string>;
  setMaster: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pool: Record<string, string[]>;
  setPool: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  assign: (id: string, key: string, value: string) => void;
  assignAll: (key: string, value: string) => void;
}) {
  const [ai, setAi] = useState<{ key: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  function onDrop(e: React.DragEvent, creativeId: string) {
    e.preventDefault();
    setDropOn(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json")) as {
        key: string;
        value: string;
      };
      if (data?.key && data.value) assign(creativeId, data.key, data.value);
    } catch {
      /* ignore */
    }
  }

  function fillAllFromFields() {
    network.texts.forEach((t) => {
      const v = master[t.key]?.trim();
      if (v) assignAll(t.key, v);
    });
  }

  return (
    <div className="ads-texts ads-fade">
      {/* Left: requirements + AI pool */}
      <div className="ads-texts-left">
        <SectionTitle
          title={`Тексты · ${network.name}`}
          hint="Заполните поля или сгенерируйте через AI, затем перетащите на фото"
        />
        {network.texts.map((t) => {
          const val = master[t.key] ?? "";
          const ratio = val.length / t.max;
          const cc = ratio > 1 ? "over" : ratio > 0.85 ? "warn" : "ok";
          return (
            <div className="ads-field" key={t.key}>
              <div className="ads-field-top">
                <label>{t.label}</label>
                <button className="ads-ai-btn" onClick={() => setAi({ key: t.key })}>
                  <IcWand size={14} /> AI
                </button>
              </div>
              <div className="ads-input-wrap">
                <input
                  value={val}
                  maxLength={t.max + 20}
                  placeholder={t.hint ?? `до ${t.max} символов`}
                  onChange={(e) => setMaster((m) => ({ ...m, [t.key]: e.target.value }))}
                />
                {val.trim() && (
                  <span
                    className="ads-field-grip"
                    draggable
                    title="Перетащите на фото"
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/json",
                        JSON.stringify({ key: t.key, value: val.trim() }),
                      )
                    }
                  >
                    <IcGrip size={16} />
                  </span>
                )}
              </div>
              <div className="ads-field-foot">
                <span className={`ads-counter ${cc}`}>
                  {val.length}/{t.max}
                </span>
                {val.trim() && (
                  <button className="ads-link" onClick={() => assignAll(t.key, val.trim())}>
                    применить всем фото
                  </button>
                )}
              </div>
              {pool[t.key]?.length ? (
                <div className="ads-pool">
                  {pool[t.key].map((v, i) => (
                    <span
                      key={i}
                      className="ads-pool-chip"
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/json",
                          JSON.stringify({ key: t.key, value: v }),
                        )
                      }
                    >
                      <IcGrip size={13} />
                      <span className="ads-pool-text">{v}</span>
                      <i>{v.length}</i>
                      <button
                        className="ads-pool-all"
                        title="Применить всем"
                        onClick={() => assignAll(t.key, v)}
                      >
                        <IcLayers size={13} />
                      </button>
                      <button
                        className="ads-pool-x"
                        onClick={() =>
                          setPool((p) => ({ ...p, [t.key]: p[t.key].filter((_, j) => j !== i) }))
                        }
                      >
                        <IcClose size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <button className="ads-btn soft full" onClick={fillAllFromFields}>
          <IcLayers size={16} /> Заполнить все фото из полей
        </button>
      </div>

      {/* Right: creatives as drop targets */}
      <div className="ads-texts-right">
        <div className="ads-texts-right-head">
          <IcImage size={16} /> Перетащите тексты на нужные фото
        </div>
        <div className="ads-assign-grid">
          {selected.map((c) => {
            const crop = c.crops[primaryFormat.id] ?? DEFAULT_CROP;
            const titleKeys = network.texts.filter((t) => t.kind === "title" && c.assigned[t.key]);
            const descKeys = network.texts.filter((t) => t.kind === "desc" && c.assigned[t.key]);
            const empty = titleKeys.length === 0 && descKeys.length === 0;
            return (
              <div
                key={c.id}
                className={`ads-assign-card${dropOn === c.id ? " dropping" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropOn(c.id);
                }}
                onDragLeave={() => setDropOn((d) => (d === c.id ? null : d))}
                onDrop={(e) => onDrop(e, c.id)}
              >
                <div className="ads-assign-media" style={{ aspectRatio: `${primaryFormat.w} / ${primaryFormat.h}` }}>
                  <div className="ads-crop-fallback" style={{ background: seedGradient(c.seed) }} />
                  <img
                    src={imgUrl(c.seed, 600)}
                    alt=""
                    draggable={false}
                    style={{ transform: `translate(${crop.px}%, ${crop.py}%) scale(${crop.zoom})` }}
                    onError={(e) => (e.currentTarget.style.opacity = "0")}
                  />
                  <div className="ads-assign-scrim" />
                  <div className="ads-assign-overlay">
                    {titleKeys.map((t) => (
                      <div key={t.key} className="ads-ov-title">
                        {c.assigned[t.key]}
                        <button className="ads-ov-x" onClick={() => assign(c.id, t.key, "")}>
                          <IcClose size={11} />
                        </button>
                      </div>
                    ))}
                    {descKeys.map((t) => (
                      <div key={t.key} className="ads-ov-desc">
                        {c.assigned[t.key]}
                        <button className="ads-ov-x" onClick={() => assign(c.id, t.key, "")}>
                          <IcClose size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {empty && (
                    <div className="ads-assign-hint">
                      <IcPlus size={18} /> Перетащите текст сюда
                    </div>
                  )}
                </div>
                <div className="ads-assign-foot">{c.title}</div>
              </div>
            );
          })}
        </div>
      </div>

      {ai && (
        <AiModal
          req={network.texts.find((t) => t.key === ai.key)!}
          onClose={() => setAi(null)}
          onAdd={(variants) => {
            setPool((p) => ({
              ...p,
              [ai.key]: Array.from(new Set([...(p[ai.key] ?? []), ...variants])),
            }));
            setAi(null);
          }}
        />
      )}
    </div>
  );
}

function AiModal({
  req,
  onClose,
  onAdd,
}: {
  req: TextReq;
  onClose: () => void;
  onAdd: (variants: string[]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState(req.max);
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function run() {
    setLoading(true);
    setVariants([]);
    window.setTimeout(() => {
      const v = generateVariants(prompt, req.kind, req.max, target);
      setVariants(v);
      setPicked(new Set(v));
      setLoading(false);
    }, 700);
  }

  return (
    <div className="ads-modal-overlay" onMouseDown={onClose}>
      <div className="ads-modal ads-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ads-modal-head">
          <div className="ads-modal-title">
            <span className="ads-ai-orb">
              <IcSparkle size={16} />
            </span>
            AI-конструктор · {req.label}
          </div>
          <button className="ads-icon-btn" onClick={onClose}>
            <IcClose size={18} />
          </button>
        </div>

        <div className="ads-modal-body">
          <label className="ads-modal-label">О чём объявление?</label>
          <textarea
            className="ads-modal-textarea"
            placeholder="напр. распродажа кроссовок Nike со скидкой 50%, бесплатная доставка"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
          <div className="ads-modal-row">
            <div className="ads-modal-len">
              <span>
                Длина: <b>{target}</b> симв.
              </span>
              <input
                type="range"
                min={Math.min(10, req.max)}
                max={req.max}
                value={target}
                onChange={(e) => setTarget(parseInt(e.target.value, 10))}
              />
              <span className="ads-modal-limit">лимит {req.max}</span>
            </div>
            <button className="ads-btn primary" onClick={run} disabled={loading}>
              {loading ? (
                <>
                  <span className="ads-spinner" /> Генерация…
                </>
              ) : (
                <>
                  <IcWand size={16} /> Сгенерировать
                </>
              )}
            </button>
          </div>

          <div className="ads-variants">
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="ads-variant skeleton-row" />
              ))}
            {!loading &&
              variants.map((v) => {
                const on = picked.has(v);
                const ratio = clamp(v.length / req.max, 0, 1);
                return (
                  <button
                    key={v}
                    className={`ads-variant${on ? " on" : ""}`}
                    onClick={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        n.has(v) ? n.delete(v) : n.add(v);
                        return n;
                      })
                    }
                  >
                    <span className={`ads-variant-check${on ? " on" : ""}`}>
                      {on && <IcCheck size={13} />}
                    </span>
                    <span className="ads-variant-text">{v}</span>
                    <span className="ads-variant-meta">
                      <span className="ads-len-bar">
                        <span style={{ width: `${ratio * 100}%` }} />
                      </span>
                      {v.length}
                    </span>
                  </button>
                );
              })}
            {!loading && variants.length === 0 && (
              <div className="ads-variants-empty">
                <IcSparkle size={22} />
                Опишите оффер и нажмите «Сгенерировать» — получите варианты нужной длины.
              </div>
            )}
          </div>
        </div>

        <div className="ads-modal-foot">
          <span className="ads-modal-foot-meta">{picked.size} выбрано</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ads-btn ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              className="ads-btn primary"
              disabled={picked.size === 0}
              onClick={() => onAdd(variants.filter((v) => picked.has(v)))}
            >
              <IcPlus size={16} /> Добавить {picked.size} в пул
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Review                                                     */
/* ------------------------------------------------------------------ */

function StepReview({
  network,
  primaryFormat,
  campaign,
  selected,
  count,
}: {
  network: Network;
  primaryFormat: Format;
  campaign: Campaign;
  selected: Creative[];
  count: number;
}) {
  return (
    <div className="ads-step-pad ads-fade">
      <div className="ads-review-head">
        <SectionTitle title="Проверьте и запускайте" hint="Так объявления увидит аудитория" />
        <div className="ads-review-stats">
          <div className="ads-rstat">
            <b>{selected.length}</b>
            <span>фото</span>
          </div>
          <div className="ads-rstat">
            <b>{network.formats.length}</b>
            <span>формата</span>
          </div>
          <div className="ads-rstat accent">
            <b>{count}</b>
            <span>объявлений</span>
          </div>
        </div>
      </div>

      <div className="ads-review-grid">
        {selected.map((c) => {
          const crop = c.crops[primaryFormat.id] ?? DEFAULT_CROP;
          const title = network.texts.find((t) => t.kind === "title" && c.assigned[t.key]);
          const desc = network.texts.find((t) => t.kind === "desc" && c.assigned[t.key]);
          return (
            <div key={c.id} className="ads-review-card">
              <div
                className="ads-review-media"
                style={{ aspectRatio: `${primaryFormat.w} / ${primaryFormat.h}` }}
              >
                <div className="ads-crop-fallback" style={{ background: seedGradient(c.seed) }} />
                <img
                  src={imgUrl(c.seed, 600)}
                  alt=""
                  draggable={false}
                  style={{ transform: `translate(${crop.px}%, ${crop.py}%) scale(${crop.zoom})` }}
                  onError={(e) => (e.currentTarget.style.opacity = "0")}
                />
                <div className="ads-assign-scrim" />
                <div className="ads-assign-overlay">
                  {title && <div className="ads-ov-title plain">{c.assigned[title.key]}</div>}
                  {desc && <div className="ads-ov-desc plain">{c.assigned[desc.key]}</div>}
                </div>
                <span className="ads-review-net" style={netVar(network.color)}>
                  {network.short}
                </span>
              </div>
              <div className="ads-review-foot">
                <span>{c.title}</span>
                <span className="ads-review-fmts">×{network.formats.length}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="ads-review-note">
        <IcMegaphone size={16} /> В кампанию <b>{campaign.name}</b> · сеть <b>{network.name}</b>
      </div>
    </div>
  );
}

function Success({ network, count, onMore }: { network: Network; count: number; onMore: () => void }) {
  return (
    <div className="ads-success ads-fade">
      <div className="ads-confetti">
        {Array.from({ length: 16 }).map((_, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 6.3) % 100}%`,
              background: ["#7c5cff", "#16c2a3", "#f59e0b", "#ec4899"][i % 4],
              animationDelay: `${(i % 8) * 0.12}s`,
            }}
          />
        ))}
      </div>
      <div className="ads-success-orb">
        <IcCheck size={40} />
      </div>
      <h2>{count} объявлений отправлено!</h2>
      <p>
        Креативы ушли в сеть <b>{network.name}</b> на модерацию. Обычно это занимает 5–15 минут.
      </p>
      <div className="ads-success-actions">
        <button className="ads-btn ghost" onClick={onMore}>
          <IcPlus size={16} /> Создать ещё
        </button>
        <button className="ads-btn primary">
          <IcArrowRight size={16} /> Перейти в кампанию
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

function SectionTitle({ n, title, hint }: { n?: number; title: string; hint?: string }) {
  return (
    <div className="ads-sectitle">
      {n && <span className="ads-sectitle-n">{n}</span>}
      <div>
        <div className="ads-sectitle-t">{title}</div>
        {hint && <div className="ads-sectitle-h">{hint}</div>}
      </div>
    </div>
  );
}

function Thumb({ seed }: { seed: string }) {
  return (
    <span className="ads-thumb">
      <span className="ads-thumb-fallback" style={{ background: seedGradient(seed) }} />
      <img
        src={imgUrl(seed, 400)}
        alt=""
        loading="lazy"
        draggable={false}
        onError={(e) => (e.currentTarget.style.opacity = "0")}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
.ads-root{
  --violet:#6d5dfc; --violet-2:#8b7bff; --violet-soft:#eef0ff;
  --ink:#1c2434; --muted:#6b7280; --faint:#9aa3b2;
  --line:#ecedf3; --line-2:#f1f2f7; --bg:#f5f6fa; --card:#fff; --field:#f4f5f9;
  --ok:#16a34a; --warn:#f59e0b; --danger:#ef4444;
  --r:16px; --shadow:0 1px 2px rgba(16,24,40,.04), 0 10px 30px rgba(16,24,40,.05);
  display:flex; min-height:100vh; background:var(--bg); color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.ads-root *{box-sizing:border-box}
.ads-root button{font-family:inherit}

/* sidebar */
.ads-side{width:248px;flex-shrink:0;background:#fff;border-right:1px solid var(--line);
  display:flex;flex-direction:column;padding:20px 16px;position:sticky;top:0;height:100vh}
.ads-logo{display:flex;align-items:center;gap:10px;padding:4px 8px 18px}
.ads-logo-badge{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;
  color:#fff;font-weight:800;font-size:13px;background:linear-gradient(135deg,#8b7bff,#6d5dfc);
  box-shadow:0 6px 14px rgba(109,93,252,.35)}
.ads-logo-text{font-weight:800;font-size:17px;letter-spacing:-.2px}
.ads-menu-label{font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--faint);
  text-transform:uppercase;padding:6px 10px}
.ads-nav{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.ads-nav-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;
  color:#525a6b;font-size:14.5px;font-weight:600;cursor:pointer;transition:.15s}
.ads-nav-item:hover{background:#f4f5f9;color:var(--ink)}
.ads-nav-item.active{background:linear-gradient(135deg,#7b6ef6,#6d5dfc);color:#fff;
  box-shadow:0 8px 20px rgba(109,93,252,.35)}
.ads-side-user{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px;
  border-top:1px solid var(--line)}
.ads-side-user-mail{font-size:13px;font-weight:700}
.ads-side-user-role{font-size:11.5px;color:var(--faint)}

/* topbar */
.ads-main{flex:1;display:flex;flex-direction:column;min-width:0}
.ads-top{height:64px;flex-shrink:0;background:#fff;border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:16px;padding:0 24px}
.ads-topsearch{flex:1;max-width:440px;display:flex;align-items:center;gap:10px;background:var(--field);
  border:1px solid transparent;border-radius:12px;padding:0 14px;height:42px;color:var(--faint)}
.ads-topsearch input{border:0;background:none;outline:none;flex:1;font-size:14px;color:var(--ink)}
.ads-topsearch:focus-within{border-color:var(--violet);background:#fff}
.ads-topright{margin-left:auto;display:flex;align-items:center;gap:14px}
.ads-icon-btn{width:38px;height:38px;border-radius:10px;border:0;background:transparent;color:#5a6271;
  display:grid;place-items:center;cursor:pointer;transition:.15s}
.ads-icon-btn:hover{background:var(--field);color:var(--ink)}
.ads-pill-all{font-size:11px;font-weight:800;letter-spacing:.1em;color:var(--violet);
  background:var(--violet-soft);padding:5px 9px;border-radius:8px}
.ads-top-mail{font-size:13.5px;color:#525a6b;font-weight:600}
.ads-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#fff;
  font-weight:800;font-size:15px;background:linear-gradient(135deg,#8b7bff,#6d5dfc)}
.ads-avatar.sm{width:34px;height:34px;font-size:13px}

/* content */
.ads-content{padding:26px 30px 60px;max-width:1320px;width:100%}
.ads-pagehead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap}
.ads-h1{font-size:26px;font-weight:800;letter-spacing:-.4px;margin:0}
.ads-sub{margin:6px 0 0;color:var(--muted);font-size:14.5px}
.ads-crumbs{display:flex;gap:8px;flex-wrap:wrap}
.ads-crumb{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);
  border-radius:999px;padding:7px 13px;font-size:13px;font-weight:600;color:#46506180}
.ads-crumb{color:#4a5365}
.ads-crumb .ads-dot{width:9px;height:9px;border-radius:50%;background:var(--net,#999)}
.ads-crumb-accent{background:var(--violet-soft);border-color:transparent;color:var(--violet)}

/* card */
.ads-card{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}

/* stepper */
.ads-stepper{display:flex;align-items:center;padding:20px 26px;border-bottom:1px solid var(--line-2);overflow-x:auto}
.ads-step-wrap{display:flex;align-items:center}
.ads-step{display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:4px;white-space:nowrap}
.ads-step-dot{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;
  background:#eef0f4;color:var(--faint);transition:.2s}
.ads-step-label{font-size:14px;font-weight:700;color:var(--faint)}
.ads-step.active .ads-step-dot{background:linear-gradient(135deg,#7b6ef6,#6d5dfc);color:#fff;
  box-shadow:0 6px 16px rgba(109,93,252,.4)}
.ads-step.active .ads-step-label{color:var(--ink)}
.ads-step.done .ads-step-dot{background:#e6f7ef;color:var(--ok)}
.ads-step.done .ads-step-label{color:#3a4254}
.ads-step.locked{cursor:not-allowed}
.ads-step-line{width:42px;height:2px;background:#eaecf1;margin:0 8px;border-radius:2px;transition:.3s}
.ads-step-line.fill{background:linear-gradient(90deg,#16c2a3,#6d5dfc)}

/* body + footer */
.ads-body{min-height:440px}
.ads-step-pad{padding:26px}
.ads-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:16px 26px;border-top:1px solid var(--line-2);background:#fcfcfe}
.ads-footer-meta{font-size:13.5px;color:var(--muted)}
.ads-footer-meta b{color:var(--ink)}
.ads-footer-actions{display:flex;gap:10px;margin-left:auto}

/* buttons */
.ads-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid transparent;border-radius:12px;
  padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;transition:.16s;white-space:nowrap}
.ads-btn.primary{background:linear-gradient(135deg,#7b6ef6,#6d5dfc);color:#fff;
  box-shadow:0 8px 18px rgba(109,93,252,.32)}
.ads-btn.primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
.ads-btn.primary:disabled{background:#dfe2ea;color:#a7adba;box-shadow:none;cursor:not-allowed;transform:none}
.ads-btn.ghost{background:#fff;border-color:var(--line);color:#46506b}
.ads-btn.ghost:hover{background:var(--field);border-color:#dfe2ea}
.ads-btn.soft{background:var(--violet-soft);color:var(--violet)}
.ads-btn.soft:hover{background:#e6e8ff}
.ads-btn.sm{padding:8px 14px;font-size:13px;border-radius:10px}
.ads-btn.lg{padding:13px 22px;font-size:15px}
.ads-btn.full{width:100%;justify-content:center;margin-top:6px}

/* section title */
.ads-sectitle{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.ads-sectitle-n{width:28px;height:28px;border-radius:9px;background:var(--violet-soft);color:var(--violet);
  display:grid;place-items:center;font-weight:800;font-size:14px;flex-shrink:0}
.ads-sectitle-t{font-size:17px;font-weight:800;letter-spacing:-.2px}
.ads-sectitle-h{font-size:13.5px;color:var(--muted);margin-top:2px}

/* dropdown */
.ads-dd{position:relative;max-width:620px}
.ads-dd-trigger{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:14px 16px;cursor:pointer;
  color:var(--ink);transition:.15s}
.ads-dd-trigger:hover{border-color:#d8dbe6}
.ads-dd-trigger.open{border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-dd-current{display:flex;align-items:center;gap:11px;min-width:0}
.ads-dd-name{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-dd-placeholder{display:flex;align-items:center;gap:10px;color:var(--faint);font-size:15px;font-weight:600}
.ads-dd-panel{position:absolute;top:calc(100% + 8px);left:0;right:0;background:#fff;border:1px solid var(--line);
  border-radius:14px;box-shadow:0 18px 50px rgba(16,24,40,.16);padding:6px;z-index:30}
.ads-dd-opt{width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:10px;
  border:0;background:none;cursor:pointer;text-align:left;transition:.12s}
.ads-dd-opt:hover{background:var(--field)}
.ads-dd-opt.sel{background:var(--violet-soft)}
.ads-net-badge{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex-shrink:0;
  color:#fff;font-weight:800;font-size:11px;background:var(--net,#6d5dfc)}
.ads-status{margin-left:auto;font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:6px}
.ads-status.active{background:#e6f7ef;color:#16a34a}
.ads-status.draft{background:#eef0f4;color:#6b7280}
.ads-status.paused{background:#fff2e2;color:#d97706}
.ads-tag{font-size:11.5px;font-weight:700;color:#5a6271;background:#f0f1f6;padding:3px 8px;border-radius:6px}

/* network block */
.ads-net-block{margin-top:30px;padding-top:26px;border-top:1px dashed var(--line)}
.ads-net-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.ads-net-pill{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);
  border-radius:12px;padding:9px 14px 9px 9px;font-size:14px;font-weight:700;color:#46506b;cursor:pointer;transition:.15s}
.ads-net-pill:hover{border-color:#d8dbe6}
.ads-net-pill.active{border-color:var(--net);background:#fff;color:var(--ink);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--net) 16%,transparent)}
.ads-net-pill .ads-net-badge{background:var(--net)}
.ads-net-specs{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ads-spec{background:var(--field);border-radius:14px;padding:16px}
.ads-spec-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:12px;color:#3a4254}
.ads-spec-chips{display:flex;flex-wrap:wrap;gap:8px}
.ads-chip-static{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);
  border-radius:9px;padding:7px 11px;font-size:13px;font-weight:600}
.ads-chip-static i{font-style:normal;color:var(--faint);font-size:12px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-readybar{margin-top:18px;display:flex;align-items:center;gap:10px;background:#e9fbf3;color:#0f7a52;
  border-radius:12px;padding:13px 16px;font-size:14px;font-weight:600}
.ads-readybar b{color:#0a5e3f}

/* photos step */
.ads-photos{display:grid;grid-template-columns:1fr 280px;min-height:440px}
.ads-photos-main{padding:24px;min-width:0}
.ads-seg{display:inline-flex;background:var(--field);border-radius:12px;padding:4px;gap:4px;margin-bottom:18px}
.ads-seg button{display:flex;align-items:center;gap:8px;border:0;background:none;padding:9px 16px;border-radius:9px;
  font-size:13.5px;font-weight:700;color:#6b7280;cursor:pointer;transition:.15s}
.ads-seg button.on{background:#fff;color:var(--ink);box-shadow:0 2px 6px rgba(16,24,40,.08)}
.ads-searchrow{display:flex;gap:10px;margin-bottom:18px}
.ads-searchbox{flex:1;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--line);
  border-radius:12px;padding:0 14px;height:46px;color:var(--faint)}
.ads-searchbox:focus-within{border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-searchbox input{flex:1;border:0;outline:none;background:none;font-size:15px;color:var(--ink)}
.ads-empty{text-align:center;padding:36px 20px}
.ads-empty-ic{width:60px;height:60px;border-radius:16px;background:var(--field);color:var(--faint);
  display:grid;place-items:center;margin:0 auto 14px}
.ads-empty p{color:var(--muted);font-size:14.5px;margin:0 0 16px}
.ads-suggest{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.ads-suggest button{background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 14px;
  font-size:13px;font-weight:600;color:#46506b;cursor:pointer;transition:.15s}
.ads-suggest button:hover{border-color:var(--violet);color:var(--violet);background:var(--violet-soft)}
.ads-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:14px}
.ads-tile{position:relative;border:0;padding:0;background:none;cursor:pointer;border-radius:14px;
  overflow:hidden;text-align:left;box-shadow:0 0 0 1px var(--line);transition:.16s}
.ads-tile:hover{transform:translateY(-2px);box-shadow:0 0 0 1px var(--line),0 10px 22px rgba(16,24,40,.12)}
.ads-tile.sel{box-shadow:0 0 0 2.5px var(--violet),0 10px 22px rgba(109,93,252,.22)}
.ads-tile-heart{position:absolute;top:8px;left:8px;width:24px;height:24px;border-radius:7px;
  background:rgba(255,255,255,.92);color:#ec4899;display:grid;place-items:center}
.ads-tile-cap{display:block;padding:9px 10px;background:#fff}
.ads-tile-cap b{display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-tile-cap i{font-style:normal;font-size:11px;color:var(--faint)}
.ads-tile-check{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;
  background:#fff;color:#cfd3dd;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.12);transition:.15s;transform:scale(.8);opacity:0}
.ads-tile:hover .ads-tile-check{opacity:1;transform:scale(1)}
.ads-tile.sel .ads-tile-check{opacity:1;transform:scale(1);background:var(--violet);color:#fff}

/* thumb */
.ads-thumb,.ads-thumb-fallback{display:block;width:100%;aspect-ratio:1/1;position:relative}
.ads-thumb{overflow:hidden}
.ads-thumb-fallback{position:absolute;inset:0}
.ads-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}

/* tray */
.ads-tray{border-left:1px solid var(--line-2);background:#fcfcfe;padding:20px 16px;display:flex;flex-direction:column}
.ads-tray-head{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;margin-bottom:14px}
.ads-count{margin-left:auto;background:var(--violet);color:#fff;font-size:12px;font-weight:800;
  min-width:22px;height:22px;border-radius:11px;display:grid;place-items:center;padding:0 7px}
.ads-tray-empty{font-size:13px;color:var(--faint);line-height:1.5;background:#fff;border:1px dashed var(--line);
  border-radius:12px;padding:16px}
.ads-tray-list{display:flex;flex-direction:column;gap:8px;overflow:auto}
.ads-tray-item{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);
  border-radius:11px;padding:7px}
.ads-tray-item .ads-thumb{width:40px;height:40px;border-radius:8px;flex-shrink:0}
.ads-tray-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.ads-tray-x{border:0;background:none;color:var(--faint);cursor:pointer;width:24px;height:24px;border-radius:6px;display:grid;place-items:center}
.ads-tray-x:hover{background:#fdeaea;color:var(--danger)}

/* resize */
.ads-resize-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ads-fmt-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 22px}
.ads-fmt-tab{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);
  border-radius:11px;padding:8px 14px 8px 10px;font-size:13.5px;font-weight:700;color:#46506b;cursor:pointer;transition:.15s}
.ads-fmt-tab:hover{border-color:#d8dbe6}
.ads-fmt-tab.on{border-color:var(--violet);color:var(--violet);background:var(--violet-soft)}
.ads-fmt-mini{width:22px;background:#cdd2de;border-radius:3px;max-height:22px}
.ads-fmt-tab.on .ads-fmt-mini{background:var(--violet)}
.ads-resize-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}
.ads-resize-card{background:var(--field);border-radius:14px;padding:12px}
.ads-resize-name{font-size:12.5px;font-weight:700;color:#46506b;margin-bottom:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-crop{position:relative;width:100%;overflow:hidden;border-radius:10px;background:#000;user-select:none}
.ads-crop.grab{cursor:grab}
.ads-crop.grab:active{cursor:grabbing}
.ads-crop-fallback{position:absolute;inset:0}
.ads-crop-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center;will-change:transform}
.ads-crop-rule{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,transparent 33.3%,rgba(255,255,255,.25) 33.3%,rgba(255,255,255,.25) 33.5%,transparent 33.5%,transparent 66.6%,rgba(255,255,255,.25) 66.6%,rgba(255,255,255,.25) 66.8%,transparent 66.8%),
  linear-gradient(0deg,transparent 33.3%,rgba(255,255,255,.25) 33.3%,rgba(255,255,255,.25) 33.5%,transparent 33.5%,transparent 66.6%,rgba(255,255,255,.25) 66.6%,rgba(255,255,255,.25) 66.8%,transparent 66.8%);
  opacity:0;transition:.2s}
.ads-crop.grab:active .ads-crop-rule{opacity:1}
.ads-crop-tools{display:flex;align-items:center;gap:8px;margin-top:10px;color:var(--faint)}
.ads-crop-tools input[type=range]{flex:1}
.ads-mini-btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 9px;font-size:12px;
  font-weight:700;color:#46506b;cursor:pointer;transition:.15s}
.ads-mini-btn:hover{border-color:var(--violet);color:var(--violet)}

/* range styling */
.ads-root input[type=range]{-webkit-appearance:none;appearance:none;height:5px;border-radius:5px;
  background:#e2e5ec;outline:none}
.ads-root input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;
  background:var(--violet);cursor:pointer;box-shadow:0 2px 6px rgba(109,93,252,.5);border:2px solid #fff}
.ads-root input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--violet);
  cursor:pointer;border:2px solid #fff}

/* texts step */
.ads-texts{display:grid;grid-template-columns:400px 1fr;min-height:440px}
.ads-texts-left{padding:24px;border-right:1px solid var(--line-2);overflow:auto}
.ads-field{margin-bottom:18px}
.ads-field-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
.ads-field-top label{font-size:13.5px;font-weight:700;color:#3a4254}
.ads-ai-btn{display:inline-flex;align-items:center;gap:5px;background:var(--violet-soft);color:var(--violet);
  border:0;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:800;cursor:pointer;transition:.15s}
.ads-ai-btn:hover{background:#e3e5ff}
.ads-input-wrap{position:relative;display:flex;align-items:center}
.ads-input-wrap input{width:100%;border:1.5px solid var(--line);border-radius:11px;padding:11px 40px 11px 13px;
  font-size:14px;color:var(--ink);background:#fff;transition:.15s}
.ads-input-wrap input:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-field-grip{position:absolute;right:8px;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;
  color:var(--faint);cursor:grab;background:var(--field)}
.ads-field-grip:active{cursor:grabbing}
.ads-field-foot{display:flex;align-items:center;justify-content:space-between;margin-top:6px;padding:0 2px}
.ads-counter{font-size:12px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-counter.ok{color:var(--faint)} .ads-counter.warn{color:var(--warn)} .ads-counter.over{color:var(--danger)}
.ads-link{border:0;background:none;color:var(--violet);font-size:12px;font-weight:700;cursor:pointer;padding:0}
.ads-link:hover{text-decoration:underline}
.ads-pool{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.ads-pool-chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);
  border-radius:9px;padding:5px 6px 5px 8px;font-size:12.5px;font-weight:600;color:#3a4254;cursor:grab;
  max-width:100%;transition:.15s}
.ads-pool-chip:hover{border-color:var(--violet);box-shadow:0 4px 10px rgba(109,93,252,.14)}
.ads-pool-chip:active{cursor:grabbing}
.ads-pool-chip>svg:first-child{color:var(--faint);flex-shrink:0}
.ads-pool-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.ads-pool-chip i{font-style:normal;font-size:11px;color:var(--faint);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-pool-all,.ads-pool-x{border:0;background:none;cursor:pointer;width:20px;height:20px;border-radius:6px;
  display:grid;place-items:center;color:var(--faint);flex-shrink:0}
.ads-pool-all:hover{background:var(--violet-soft);color:var(--violet)}
.ads-pool-x:hover{background:#fdeaea;color:var(--danger)}

.ads-texts-right{padding:24px;background:#fcfcfe;overflow:auto}
.ads-texts-right-head{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:#46506b;margin-bottom:16px}
.ads-assign-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.ads-assign-card{border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px var(--line);transition:.16s}
.ads-assign-card.dropping{box-shadow:0 0 0 2.5px var(--violet),0 12px 26px rgba(109,93,252,.25);transform:translateY(-2px)}
.ads-assign-media{position:relative;overflow:hidden;background:#000}
.ads-assign-media>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center}
.ads-assign-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 30%,rgba(0,0,0,.7))}
.ads-assign-overlay{position:absolute;left:0;right:0;bottom:0;padding:12px;display:flex;flex-direction:column;gap:5px}
.ads-ov-title{position:relative;color:#fff;font-weight:800;font-size:15px;line-height:1.25;text-shadow:0 1px 4px rgba(0,0,0,.4);padding-right:18px}
.ads-ov-desc{position:relative;color:rgba(255,255,255,.92);font-size:12.5px;line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,.4);padding-right:18px}
.ads-ov-title.plain,.ads-ov-desc.plain{padding-right:0}
.ads-ov-x{position:absolute;top:-2px;right:-4px;width:18px;height:18px;border-radius:50%;border:0;
  background:rgba(0,0,0,.45);color:#fff;cursor:pointer;display:grid;place-items:center;opacity:0;transition:.15s}
.ads-assign-card:hover .ads-ov-x{opacity:1}
.ads-assign-hint{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:6px;color:rgba(255,255,255,.85);font-size:13px;font-weight:600;background:rgba(0,0,0,.18);
  border:2px dashed rgba(255,255,255,.4);margin:10px;border-radius:10px}
.ads-assign-foot{padding:9px 12px;font-size:12.5px;font-weight:600;color:#46506b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* modal */
.ads-modal-overlay{position:fixed;inset:0;background:rgba(20,24,38,.45);backdrop-filter:blur(3px);
  display:grid;place-items:center;z-index:100;padding:20px}
.ads-modal{width:min(560px,100%);max-height:88vh;background:#fff;border-radius:20px;display:flex;flex-direction:column;
  overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.3)}
.ads-modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line-2)}
.ads-modal-title{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:800}
.ads-ai-orb{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;
  background:linear-gradient(135deg,#8b7bff,#6d5dfc);box-shadow:0 6px 14px rgba(109,93,252,.4)}
.ads-modal-body{padding:20px;overflow:auto}
.ads-modal-label{display:block;font-size:13px;font-weight:700;color:#3a4254;margin-bottom:8px}
.ads-modal-textarea{width:100%;min-height:78px;resize:vertical;border:1.5px solid var(--line);border-radius:12px;
  padding:12px 14px;font-size:14px;font-family:inherit;color:var(--ink)}
.ads-modal-textarea:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-modal-row{display:flex;align-items:center;gap:14px;margin:14px 0 6px;flex-wrap:wrap}
.ads-modal-len{flex:1;min-width:200px;display:flex;align-items:center;gap:10px;font-size:13px;color:#46506b}
.ads-modal-len input{flex:1}
.ads-modal-len b{color:var(--ink)}
.ads-modal-limit{font-size:12px;color:var(--faint);white-space:nowrap}
.ads-variants{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.ads-variant{display:flex;align-items:center;gap:11px;width:100%;text-align:left;background:#fff;border:1.5px solid var(--line);
  border-radius:11px;padding:11px 13px;cursor:pointer;transition:.14s}
.ads-variant:hover{border-color:#cfd3e2}
.ads-variant.on{border-color:var(--violet);background:var(--violet-soft)}
.ads-variant-check{width:20px;height:20px;border-radius:6px;border:1.5px solid #d3d7e2;display:grid;place-items:center;
  flex-shrink:0;color:#fff;transition:.14s}
.ads-variant-check.on{background:var(--violet);border-color:var(--violet)}
.ads-variant-text{flex:1;font-size:14px;font-weight:600}
.ads-variant-meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--faint);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-len-bar{width:46px;height:5px;border-radius:5px;background:#e6e8f0;overflow:hidden}
.ads-len-bar span{display:block;height:100%;background:linear-gradient(90deg,#16c2a3,#6d5dfc)}
.ads-variants-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px;text-align:center;
  color:var(--muted);font-size:13.5px}
.ads-variants-empty svg{color:var(--violet)}
.ads-modal-foot{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-top:1px solid var(--line-2);background:#fcfcfe}
.ads-modal-foot-meta{font-size:13px;color:var(--muted);font-weight:600}

/* review */
.ads-review-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.ads-review-stats{display:flex;gap:10px}
.ads-rstat{background:var(--field);border-radius:12px;padding:10px 18px;text-align:center;min-width:74px}
.ads-rstat b{display:block;font-size:22px;font-weight:800;line-height:1}
.ads-rstat span{font-size:11.5px;color:var(--muted);font-weight:600}
.ads-rstat.accent{background:var(--violet-soft)} .ads-rstat.accent b{color:var(--violet)}
.ads-review-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;margin-top:18px}
.ads-review-card{border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px var(--line)}
.ads-review-media{position:relative;overflow:hidden;background:#000}
.ads-review-media>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center}
.ads-review-net{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;
  font-size:11px;font-weight:800;color:#fff;background:var(--net,#6d5dfc);box-shadow:0 2px 6px rgba(0,0,0,.25)}
.ads-review-foot{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;font-size:12.5px;font-weight:600;color:#46506b}
.ads-review-fmts{color:var(--faint);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-review-note{margin-top:20px;display:flex;align-items:center;gap:9px;font-size:14px;color:#46506b;
  background:var(--field);border-radius:12px;padding:13px 16px}

/* success */
.ads-success{position:relative;text-align:center;padding:56px 26px 64px;overflow:hidden}
.ads-success-orb{width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#16c2a3,#0fb892);
  color:#fff;display:grid;place-items:center;margin:0 auto 22px;box-shadow:0 14px 34px rgba(16,194,163,.45);animation:pop .4s ease}
.ads-success h2{font-size:26px;font-weight:800;margin:0 0 8px;letter-spacing:-.4px}
.ads-success p{color:var(--muted);font-size:15px;max-width:420px;margin:0 auto 26px;line-height:1.5}
.ads-success-actions{display:flex;gap:12px;justify-content:center}
.ads-confetti{position:absolute;inset:0;pointer-events:none}
.ads-confetti span{position:absolute;top:-12px;width:9px;height:9px;border-radius:2px;opacity:.9;
  animation:confetti 1.5s linear infinite}

/* skeletons / animation */
.skeleton{background:linear-gradient(90deg,#eef0f4 25%,#f6f7fa 37%,#eef0f4 63%);background-size:400% 100%;
  animation:shimmer 1.3s infinite;border-radius:14px;aspect-ratio:1/1;box-shadow:none}
.skeleton-row{height:46px;border-radius:11px;background:linear-gradient(90deg,#eef0f4 25%,#f6f7fa 37%,#eef0f4 63%);
  background-size:400% 100%;animation:shimmer 1.3s infinite}
.ads-spinner{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;animation:spin .7s linear infinite}
.ads-fade{animation:fadeUp .3s ease}
.ads-pop{animation:pop .18s ease}
@keyframes shimmer{to{background-position:-400% 0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
@keyframes confetti{to{transform:translateY(420px) rotate(540deg);opacity:0}}

@media(max-width:1080px){
  .ads-side{display:none}
  .ads-photos,.ads-texts{grid-template-columns:1fr}
  .ads-texts-left{border-right:0;border-bottom:1px solid var(--line-2)}
  .ads-tray{border-left:0;border-top:1px solid var(--line-2)}
  .ads-net-specs{grid-template-columns:1fr}
}
`;
