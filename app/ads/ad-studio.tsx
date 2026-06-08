"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAMPAIGNS,
  FAVORITES,
  FLOWS,
  FLOW_DOMAINS,
  NETWORKS,
  NEWS,
  NEWS_CATEGORIES,
  assetFull,
  assetThumb,
  flowUrl,
  generateVariants,
  px,
  searchImages,
  seedGradient,
  type Asset,
  type Campaign,
  type Flow,
  type Format,
  type Network,
  type News,
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
  IcEye,
  IcGlobe,
  IcGrip,
  IcHeart,
  IcHeartFill,
  IcHome,
  IcImage,
  IcLayers,
  IcLink,
  IcMegaphone,
  IcPlay,
  IcPlus,
  IcRefresh,
  IcScript,
  IcSearch,
  IcShield,
  IcSparkle,
  IcStar,
  IcStarFill,
  IcTerminal,
  IcUpload,
  IcWand,
  IcZoom,
} from "./icons";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

type Crop = { k: number; cx: number; cy: number };
type Creative = Asset & { crops: Record<string, Crop>; assigned: Record<string, string> };
const DEFAULT_CROP: Crop = { k: 1, cx: 0.5, cy: 0.5 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const netVar = (color?: string): React.CSSProperties =>
  ({ "--net": color ?? "#6d5dfc" }) as React.CSSProperties;

function cropRect(natAR: number, fmtAR: number, c: Crop) {
  const base = natAR >= fmtAR ? { bw: fmtAR / natAR, bh: 1 } : { bw: 1, bh: natAR / fmtAR };
  const nw = base.bw * c.k;
  const nh = base.bh * c.k;
  const nx = clamp(c.cx - nw / 2, 0, 1 - nw);
  const ny = clamp(c.cy - nh / 2, 0, 1 - nh);
  return { nx, ny, nw, nh, base };
}

const STEPS = [
  { id: 0, label: "Кампания", icon: IcMegaphone },
  { id: 1, label: "Новость", icon: IcGlobe },
  { id: 2, label: "Поток", icon: IcLink },
  { id: 3, label: "Фото", icon: IcImage },
  { id: 4, label: "Ресайз", icon: IcCrop },
  { id: 5, label: "Тексты", icon: IcSparkle },
  { id: 6, label: "Готово", icon: IcCheck },
];
const SUGGESTIONS = ["кроссовки", "часы", "куртка", "смартфон", "кофе", "авто"];

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

export default function AdStudio() {
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [campaignId, setCampaignId] = useState("");
  const [networkId, setNetworkId] = useState("");

  // news
  const [newsTab, setNewsTab] = useState<"all" | "mine">("all");
  const [newsQuery, setNewsQuery] = useState("");
  const [newsCat, setNewsCat] = useState("");
  const [newsSort, setNewsSort] = useState<"new" | "pop">("pop");
  const [newsFavs, setNewsFavs] = useState<Set<string>>(new Set(["n1"]));
  const [newsId, setNewsId] = useState("");

  // flow
  const [flowRegion, setFlowRegion] = useState("Все");
  const [flowType, setFlowType] = useState<"redirect" | "direct">("redirect");
  const [flowDomain, setFlowDomain] = useState("sneadpails.com");
  const [flowQuery, setFlowQuery] = useState("");
  const [flowId, setFlowId] = useState("");
  const [subids, setSubids] = useState<Record<string, string>>({});

  // photos
  const [tab, setTab] = useState<"fav" | "search" | "upload">("fav");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[]>([]);
  const [searching, setSearching] = useState(false);
  const [favorites, setFavorites] = useState<Asset[]>(FAVORITES);
  const [uploads, setUploads] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Creative[]>([]);
  const [activeFormat, setActiveFormat] = useState("");

  // texts
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [gen, setGen] = useState<Record<string, string[]>>({});

  const campaign = useMemo(() => CAMPAIGNS.find((c) => c.id === campaignId), [campaignId]);
  const network = useMemo(() => NETWORKS.find((n) => n.id === networkId), [networkId]);
  const news = useMemo(() => NEWS.find((n) => n.id === newsId), [newsId]);
  const flow = useMemo(() => FLOWS.find((f) => f.id === flowId), [flowId]);
  const primaryFormat = network?.formats[0];
  const adsCount = network ? selected.length * network.formats.length : 0;

  useEffect(() => {
    if (network && !network.formats.some((f) => f.id === activeFormat))
      setActiveFormat(network.formats[0]?.id ?? "");
  }, [network, activeFormat]);

  useEffect(() => {
    if (news) setAiPrompt((p) => p || news.title);
  }, [news]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  /* photos */
  const isSelected = (id: string) => selected.some((c) => c.id === id);
  function toggle(a: Asset) {
    setSelected((prev) =>
      prev.some((c) => c.id === a.id)
        ? prev.filter((c) => c.id !== a.id)
        : [...prev, { ...a, crops: {}, assigned: {} }],
    );
  }
  const isFav = (id: string) => favorites.some((f) => f.id === id);
  function toggleFav(a: Asset) {
    setFavorites((prev) =>
      prev.some((f) => f.id === a.id) ? prev.filter((f) => f.id !== a.id) : [{ ...a }, ...prev],
    );
    flash(isFav(a.id) ? "Удалено из избранного" : "Добавлено в избранное");
  }
  function addFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file, i) => {
      if (!file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const a: Asset = {
          id: `u_${Date.now()}_${i}`,
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 28) || "Моё фото",
          source: "мой компьютер",
          seed: `u${Date.now()}${i}`,
          url,
          nw: img.naturalWidth || 1000,
          nh: img.naturalHeight || 1000,
        };
        setUploads((p) => [a, ...p]);
        setSelected((p) => [...p, { ...a, crops: {}, assigned: {} }]);
      };
      img.src = url;
    });
    flash("Фото загружены и добавлены в выбранные");
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
  function buildGen(prompt: string): Record<string, string[]> {
    const g: Record<string, string[]> = {};
    network?.texts.forEach((t) => (g[t.key] = generateVariants(prompt, t.kind, t.max, t.max)));
    return g;
  }
  function generateAll() {
    if (!network) return;
    setAiBusy(true);
    window.setTimeout(() => {
      setGen(buildGen(aiPrompt));
      setAiBusy(false);
    }, 650);
  }
  function fillUnique() {
    if (!network) return;
    const g = Object.keys(gen).length ? gen : buildGen(aiPrompt);
    if (!Object.keys(gen).length) setGen(g);
    setSelected((prev) =>
      prev.map((c, i) => {
        const assigned = { ...c.assigned };
        network.texts.forEach((t) => {
          const pool = g[t.key] ?? [];
          if (pool.length) assigned[t.key] = pool[i % pool.length];
        });
        return { ...c, assigned };
      }),
    );
    flash("Каждой картинке — уникальный текст ✨");
  }
  function fillCard(id: string, index: number) {
    if (!network) return;
    const g = Object.keys(gen).length ? gen : buildGen(aiPrompt);
    if (!Object.keys(gen).length) setGen(g);
    const assigned: Record<string, string> = {};
    network.texts.forEach((t) => {
      const pool = g[t.key] ?? [];
      if (pool.length) assigned[t.key] = pool[index % pool.length];
    });
    setSelected((prev) =>
      prev.map((c) => (c.id === id ? { ...c, assigned: { ...c.assigned, ...assigned } } : c)),
    );
  }

  /* nav */
  const canNext =
    (step === 0 && !!campaign && !!network) ||
    (step === 1 && !!newsId) ||
    (step === 2 && !!flowId) ||
    (step === 3 && selected.length > 0) ||
    step === 4 ||
    step === 5;

  function go(n: number) {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
  }
  const next = () => step < 6 && go(step + 1);
  const back = () => step > 0 && setStep(step - 1);
  function reset() {
    setStep(0);
    setMaxStep(0);
    setDone(false);
    setCampaignId("");
    setNetworkId("");
    setNewsId("");
    setFlowId("");
    setSelected([]);
    setUploads([]);
    setTab("fav");
    setQuery("");
    setResults([]);
    setGen({});
    setAiPrompt("");
  }

  function doSearch(q?: string) {
    const term = (q ?? query).trim();
    setQuery(term);
    setSearching(true);
    setResults([]);
    window.setTimeout(() => {
      setResults(searchImages(term));
      setSearching(false);
    }, 480);
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
                Кампания → новость → поток → фото → ресайз → тексты. Пачка креативов за пару минут.
              </p>
            </div>
            <div className="ads-crumbs">
              {campaign && (
                <span className="ads-crumb">
                  <IcMegaphone size={14} /> {campaign.name}
                </span>
              )}
              {network && (
                <span className="ads-crumb" style={netVar(network.color)}>
                  <span className="ads-dot" /> {network.name}
                </span>
              )}
              {news && (
                <span className="ads-crumb">
                  <IcGlobe size={14} /> {news.title.slice(0, 22)}…
                </span>
              )}
              {flow && (
                <span className="ads-crumb">
                  <IcLink size={14} /> {flow.id}
                </span>
              )}
              {selected.length > 0 && (
                <span className="ads-crumb ads-crumb-accent">
                  <IcImage size={14} /> {selected.length} фото · {adsCount} объявл.
                </span>
              )}
            </div>
          </div>

          <div className="ads-card">
            {!done && <Stepper step={step} maxStep={maxStep} go={go} />}
            <div className="ads-body">
              {done ? (
                <Success network={network!} count={adsCount} onMore={reset} />
              ) : step === 0 ? (
                <StepCampaign
                  campaign={campaign}
                  network={network}
                  onNetwork={(id) => {
                    setNetworkId(id);
                    if (campaign && campaign.net !== id) setCampaignId("");
                  }}
                  onPickCampaign={(c) => setCampaignId(c.id)}
                  selectedCount={selected.length}
                />
              ) : step === 1 ? (
                <StepNews
                  tab={newsTab}
                  setTab={setNewsTab}
                  query={newsQuery}
                  setQuery={setNewsQuery}
                  cat={newsCat}
                  setCat={setNewsCat}
                  sort={newsSort}
                  setSort={setNewsSort}
                  favs={newsFavs}
                  toggleFav={(id) =>
                    setNewsFavs((s) => {
                      const n = new Set(s);
                      n.has(id) ? n.delete(id) : n.add(id);
                      return n;
                    })
                  }
                  selectedId={newsId}
                  onSelect={setNewsId}
                  onPreview={() => flash("Предпросмотр новости")}
                />
              ) : step === 2 ? (
                <StepFlow
                  region={flowRegion}
                  setRegion={setFlowRegion}
                  type={flowType}
                  setType={setFlowType}
                  domain={flowDomain}
                  setDomain={setFlowDomain}
                  query={flowQuery}
                  setQuery={setFlowQuery}
                  selectedId={flowId}
                  onSelect={setFlowId}
                  subids={subids}
                  setSubids={setSubids}
                />
              ) : step === 3 ? (
                <StepPhotos
                  tab={tab}
                  setTab={setTab}
                  query={query}
                  setQuery={setQuery}
                  results={results}
                  searching={searching}
                  doSearch={doSearch}
                  favorites={favorites}
                  uploads={uploads}
                  selected={selected}
                  isSelected={isSelected}
                  toggle={toggle}
                  isFav={isFav}
                  toggleFav={toggleFav}
                  addFiles={addFiles}
                />
              ) : step === 4 ? (
                <StepResize
                  network={network!}
                  selected={selected}
                  activeFormat={activeFormat}
                  setActiveFormat={setActiveFormat}
                  setCrop={setCrop}
                  setSelected={setSelected}
                />
              ) : step === 5 ? (
                <StepTexts
                  network={network!}
                  primaryFormat={primaryFormat!}
                  selected={selected}
                  aiPrompt={aiPrompt}
                  setAiPrompt={setAiPrompt}
                  aiBusy={aiBusy}
                  gen={gen}
                  generateAll={generateAll}
                  assign={assign}
                  assignAll={assignAll}
                  fillUnique={fillUnique}
                  fillCard={fillCard}
                />
              ) : (
                <StepReview
                  network={network!}
                  primaryFormat={primaryFormat!}
                  campaign={campaign!}
                  news={news!}
                  flow={flow!}
                  selected={selected}
                  count={adsCount}
                />
              )}
            </div>

            {!done && (
              <div className="ads-footer">
                <div className="ads-footer-meta">
                  {step === 3 && (
                    <span>
                      Выбрано <b>{selected.length}</b>
                    </span>
                  )}
                  {step >= 4 && network && (
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
                  {step < 6 ? (
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
      {toast && (
        <div className="ads-toast ads-pop">
          <IcCheck size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
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

function Stepper({ step, maxStep, go }: { step: number; maxStep: number; go: (n: number) => void }) {
  return (
    <div className="ads-stepper">
      {STEPS.map((s, i) => {
        const state = i < step ? "done" : i === step ? "active" : "todo";
        const reachable = i <= maxStep;
        return (
          <div key={s.id} className="ads-step-wrap">
            <button
              className={`ads-step ${state}${reachable ? "" : " locked"}`}
              onClick={() => reachable && go(i)}
              disabled={!reachable}
            >
              <span className="ads-step-dot">
                {state === "done" ? <IcCheck size={15} /> : <s.icon size={15} />}
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

function SectionTitle({ n, title, hint }: { n?: number; title: string; hint?: string }) {
  return (
    <div className="ads-sectitle">
      {n != null && <span className="ads-sectitle-n">{n}</span>}
      <div>
        <div className="ads-sectitle-t">{title}</div>
        {hint && <div className="ads-sectitle-h">{hint}</div>}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const cur = options.find((o) => o.value === value);
  return (
    <div className="ads-sel" ref={ref}>
      <button className={`ads-sel-btn${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span className={cur ? "" : "ph"}>{cur ? cur.label : placeholder}</span>
        <IcChevronDown size={16} style={{ marginLeft: "auto", transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="ads-sel-panel ads-pop">
          {options.map((o) => (
            <button
              key={o.value}
              className={`ads-sel-opt${o.value === value ? " sel" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
              {o.value === value && <IcCheck size={14} style={{ color: "var(--violet)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Thumb({ seed, url }: { seed: string; url?: string }) {
  return (
    <span className="ads-thumb">
      <span className="ads-thumb-fallback" style={{ background: seedGradient(seed) }} />
      <img
        src={url ?? assetThumb({ id: "", title: "", source: "", seed, nw: 1, nh: 1 }, 400)}
        alt=""
        loading="lazy"
        draggable={false}
        onError={(e) => (e.currentTarget.style.opacity = "0")}
      />
    </span>
  );
}

function Cropped({ c, f }: { c: Creative; f: Format }) {
  const natAR = c.nw / c.nh;
  const fmtAR = f.w / f.h;
  const r = cropRect(natAR, fmtAR, c.crops[f.id] ?? DEFAULT_CROP);
  const dx = 1 - r.nw;
  const dy = 1 - r.nh;
  return (
    <>
      <div className="ads-crop-fallback" style={{ background: seedGradient(c.seed) }} />
      <div
        className="ads-cropped"
        style={{
          backgroundImage: `url(${assetFull(c)})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${100 / r.nw}% ${100 / r.nh}%`,
          backgroundPosition: `${dx > 0.0001 ? (r.nx / dx) * 100 : 0}% ${dy > 0.0001 ? (r.ny / dy) * 100 : 0}%`,
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 0 — Campaign                                                   */
/* ------------------------------------------------------------------ */

function StepCampaign({
  campaign,
  network,
  onPickCampaign,
  onNetwork,
  selectedCount,
}: {
  campaign?: Campaign;
  network?: Network;
  onPickCampaign: (c: Campaign) => void;
  onNetwork: (id: string) => void;
  selectedCount: number;
}) {
  const campaigns = network ? CAMPAIGNS.filter((c) => c.net === network.id) : [];
  return (
    <div className="ads-step-pad ads-fade">
      <SectionTitle n={1} title="Выберите рекламную сеть" hint="Она определяет форматы и лимиты текстов" />
      <div className="ads-net-pills">
        {NETWORKS.map((nw) => (
          <button
            key={nw.id}
            className={`ads-net-pill${nw.id === network?.id ? " active" : ""}`}
            style={netVar(nw.color)}
            onClick={() => onNetwork(nw.id)}
          >
            <span className="ads-net-badge">{nw.short}</span>
            {nw.name}
          </button>
        ))}
      </div>
      {network && (
        <div className="ads-net-block ads-fade">
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
          <div style={{ marginTop: 26 }}>
            <SectionTitle n={2} title="Выберите рекламную кампанию" hint={`Кампании сети ${network.name}`} />
            <CampaignDropdown campaign={campaign} campaigns={campaigns} onPick={onPickCampaign} />
          </div>
          {campaign && (
            <div className="ads-readybar">
              <IcCheck size={16} /> Готово. Каждое фото станет {network.formats.length} объявлениями
              {selectedCount > 0 ? ` — итого ${selectedCount * network.formats.length}.` : "."} Жмите{" "}
              <b>Далее</b>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignDropdown({
  campaign,
  campaigns,
  onPick,
}: {
  campaign?: Campaign;
  campaigns: Campaign[];
  onPick: (c: Campaign) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
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
          {campaigns.map((c) => {
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — News                                                       */
/* ------------------------------------------------------------------ */

function StepNews({
  tab,
  setTab,
  query,
  setQuery,
  cat,
  setCat,
  sort,
  setSort,
  favs,
  toggleFav,
  selectedId,
  onSelect,
  onPreview,
}: {
  tab: "all" | "mine";
  setTab: (t: "all" | "mine") => void;
  query: string;
  setQuery: (s: string) => void;
  cat: string;
  setCat: (s: string) => void;
  sort: "new" | "pop";
  setSort: (s: "new" | "pop") => void;
  favs: Set<string>;
  toggleFav: (id: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onPreview: () => void;
}) {
  const list = useMemo(() => {
    let l = NEWS.slice();
    if (tab === "mine") l = l.filter((n) => n.mine || favs.has(n.id));
    if (cat) l = l.filter((n) => n.category === cat);
    if (query.trim()) l = l.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase()));
    l.sort((a, b) => (sort === "pop" ? b.popularity - a.popularity : a.id < b.id ? 1 : -1));
    return l;
  }, [tab, cat, query, sort, favs]);

  return (
    <div className="ads-step-pad ads-fade">
      <SectionTitle
        title="Выберите новость"
        hint="Подтягиваются по API из вашего проекта новостей — можно искать и брать из избранного"
      />
      <div className="ads-seg" style={{ marginBottom: 14 }}>
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          Все новости
        </button>
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
          <IcStar size={15} /> Мои новости
        </button>
      </div>

      <div className="ads-news-toolbar">
        <Select
          value={cat}
          onChange={setCat}
          placeholder="Категория"
          options={[{ value: "", label: "Все категории" }, ...NEWS_CATEGORIES.map((c) => ({ value: c, label: c }))]}
        />
        <Select value="active" onChange={() => {}} options={[{ value: "active", label: "Активный" }]} />
        <Select value="ru" onChange={() => {}} options={[{ value: "ru", label: "Русский" }]} />
        <div className="ads-news-search">
          <IcSearch size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по заголовку новости"
          />
        </div>
        <div className="ads-seg sm">
          <button className={sort === "new" ? "on" : ""} onClick={() => setSort("new")}>
            Новое
          </button>
          <button className={sort === "pop" ? "on" : ""} onClick={() => setSort("pop")}>
            Популярное
          </button>
        </div>
      </div>

      <div className="ads-news-head">
        <span>Картинка</span>
        <span>Заголовок</span>
        <span>Категория</span>
        <span>Статус</span>
        <span style={{ textAlign: "right" }}>Действия</span>
      </div>
      <div className="ads-news-list">
        {list.map((n) => {
          const on = selectedId === n.id;
          return (
            <div
              key={n.id}
              className={`ads-news-row${on ? " sel" : ""}`}
              onClick={() => onSelect(n.id)}
            >
              <div className="ads-news-thumb">
                <img src={px(n.seed, 200, 140)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.opacity = "0")} />
                {n.video && (
                  <span className="ads-news-play">
                    <IcPlay size={13} />
                  </span>
                )}
              </div>
              <div className="ads-news-title">{n.title}</div>
              <div>
                <span className="ads-news-cat">{n.category}</span>
              </div>
              <div>
                <span className={`ads-news-status${n.status === "Активный" ? " ok" : ""}`}>
                  {n.status}
                </span>
              </div>
              <div className="ads-news-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`ads-na-btn${favs.has(n.id) ? " star" : ""}`}
                  title="В избранное"
                  onClick={() => toggleFav(n.id)}
                >
                  {favs.has(n.id) ? <IcStarFill size={16} /> : <IcStar size={16} />}
                </button>
                <button className="ads-na-btn" title="Предпросмотр" onClick={onPreview}>
                  <IcEye size={16} />
                </button>
                <span className={`ads-news-radio${on ? " on" : ""}`}>{on && <IcCheck size={13} />}</span>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="ads-news-empty">Ничего не найдено — измените фильтры.</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Flow                                                       */
/* ------------------------------------------------------------------ */

function StepFlow({
  region,
  setRegion,
  type,
  setType,
  domain,
  setDomain,
  query,
  setQuery,
  selectedId,
  onSelect,
  subids,
  setSubids,
}: {
  region: string;
  setRegion: (s: string) => void;
  type: "redirect" | "direct";
  setType: (t: "redirect" | "direct") => void;
  domain: string;
  setDomain: (s: string) => void;
  query: string;
  setQuery: (s: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  subids: Record<string, string>;
  setSubids: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const list = FLOWS.filter(
    (f) =>
      (region === "Все" || f.region === region) &&
      f.type === type &&
      (`${f.id} ${f.name}`.toLowerCase().includes(query.trim().toLowerCase()) || !query.trim()),
  );
  const SUB_KEYS = ["SID", "SUBID1", "SUBID2", "SUBID3", "SUBID4", "SUBID5"];

  return (
    <div className="ads-step-pad ads-fade">
      <SectionTitle
        title="Выберите свой поток"
        hint="Макросы автоматически подставляются в ссылку. SUBID настраиваются под аналитику"
      />
      <div className="ads-flow-toolbar">
        <label>
          Регион
          <Select
            value={region}
            onChange={setRegion}
            options={["Все", "RU", "EU", "CIS"].map((r) => ({ value: r, label: r }))}
          />
        </label>
        <label>
          Тип ссылки
          <Select
            value={type}
            onChange={(v) => setType(v as "redirect" | "direct")}
            options={[
              { value: "redirect", label: "С редиректом" },
              { value: "direct", label: "Без редиректа" },
            ]}
          />
        </label>
        <label>
          Домен
          <Select value={domain} onChange={setDomain} options={FLOW_DOMAINS.map((d) => ({ value: d, label: d }))} />
        </label>
        <label>
          Поток
          <div className="ads-news-search">
            <IcSearch size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск потоков" />
          </div>
        </label>
      </div>

      <div className="ads-flow-list">
        {list.map((f) => {
          const on = selectedId === f.id;
          const url = flowUrl(f, domain);
          return (
            <div key={f.id} className={`ads-flow-card${on ? " sel" : ""}`} onClick={() => onSelect(f.id)}>
              <div className="ads-flow-top">
                <div className="ads-flow-name">
                  <b>{f.id}</b> {f.name}
                </div>
                <button className={`ads-flow-pick${on ? " on" : ""}`} onClick={() => onSelect(f.id)}>
                  {on ? (
                    <>
                      <IcCheck size={15} /> Выбран
                    </>
                  ) : (
                    "Выбрать поток"
                  )}
                </button>
              </div>
              <div className="ads-flow-urlrow" onClick={(e) => e.stopPropagation()}>
                <div className="ads-flow-url">{url}</div>
              </div>
              <div className="ads-flow-subs" onClick={(e) => e.stopPropagation()}>
                {SUB_KEYS.map((k) => (
                  <input
                    key={k}
                    className={k === "SID" ? "macro" : ""}
                    placeholder={k === "SID" ? "[SID]" : k}
                    value={k === "SID" ? "[SID]" : subids[`${f.id}_${k}`] ?? ""}
                    readOnly={k === "SID"}
                    onChange={(e) => setSubids((s) => ({ ...s, [`${f.id}_${k}`]: e.target.value }))}
                  />
                ))}
              </div>
              <div className="ads-flow-note">
                <IcLink size={13} /> Макросы автоматически подставляются в ссылку
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="ads-news-empty">Потоки не найдены — измените фильтры.</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Photos                                                     */
/* ------------------------------------------------------------------ */

function PhotoTile({
  a,
  selected,
  fav,
  onSel,
  onFav,
}: {
  a: Asset;
  selected: boolean;
  fav: boolean;
  onSel: () => void;
  onFav: () => void;
}) {
  return (
    <div className={`ads-tile${selected ? " sel" : ""}`} onClick={onSel} role="button" tabIndex={0} title={a.title}>
      <Thumb seed={a.seed} url={a.url} />
      <button
        className={`ads-fav-btn${fav ? " on" : ""}`}
        title={fav ? "В избранном" : "В избранное"}
        onClick={(e) => {
          e.stopPropagation();
          onFav();
        }}
      >
        {fav ? <IcHeartFill size={14} /> : <IcHeart size={14} />}
      </button>
      <span className="ads-tile-cap">
        <b>{a.title}</b>
        <i>{a.source}</i>
      </span>
      <span className="ads-tile-check">
        <IcCheck size={15} />
      </span>
    </div>
  );
}

function StepPhotos({
  tab,
  setTab,
  query,
  setQuery,
  results,
  searching,
  doSearch,
  favorites,
  uploads,
  selected,
  isSelected,
  toggle,
  isFav,
  toggleFav,
  addFiles,
}: {
  tab: "fav" | "search" | "upload";
  setTab: (t: "fav" | "search" | "upload") => void;
  query: string;
  setQuery: (s: string) => void;
  results: Asset[];
  searching: boolean;
  doSearch: (q?: string) => void;
  favorites: Asset[];
  uploads: Asset[];
  selected: Creative[];
  isSelected: (id: string) => boolean;
  toggle: (a: Asset) => void;
  isFav: (id: string) => boolean;
  toggleFav: (a: Asset) => void;
  addFiles: (f: FileList | null) => void;
}) {
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="ads-photos ads-fade">
      <div className="ads-photos-main">
        <div className="ads-seg">
          <button className={tab === "fav" ? "on" : ""} onClick={() => setTab("fav")}>
            <IcHeart size={16} /> Избранное
          </button>
          <button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>
            <IcSearch size={16} /> Поиск · Google
          </button>
          <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>
            <IcUpload size={16} /> Загрузка
          </button>
        </div>

        {tab === "search" && (
          <>
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
            {!searching && results.length === 0 && (
              <div className="ads-empty">
                <div className="ads-empty-ic">
                  <IcSearch size={28} />
                </div>
                <p>Найдём картинки в Google. Понравившиеся — добавляйте в избранное ♥</p>
                <div className="ads-suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => doSearch(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "upload" && (
          <>
            <div
              className={`ads-upload${drag ? " drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => addFiles(e.target.files)}
              />
              <div className="ads-upload-ic">
                <IcUpload size={30} />
              </div>
              <b>Перетащите фото сюда</b>
              <span>или нажмите, чтобы выбрать с компьютера · JPG, PNG, WEBP</span>
            </div>
            {uploads.length === 0 && (
              <p className="ads-up-hint">Загруженные фото появятся ниже — их тоже можно добавить в избранное.</p>
            )}
          </>
        )}

        <div className="ads-grid">
          {searching && Array.from({ length: 8 }).map((_, i) => <div key={i} className="ads-tile skeleton" />)}
          {!searching &&
            (tab === "fav" ? favorites : tab === "search" ? results : uploads).map((a) => (
              <PhotoTile
                key={a.id}
                a={a}
                selected={isSelected(a.id)}
                fav={isFav(a.id)}
                onSel={() => toggle(a)}
                onFav={() => toggleFav(a)}
              />
            ))}
        </div>
      </div>

      <aside className="ads-tray">
        <div className="ads-tray-head">
          <IcLayers size={16} /> Выбранные
          <span className="ads-count">{selected.length}</span>
        </div>
        {selected.length === 0 ? (
          <div className="ads-tray-empty">Кликайте по фото — собирайте сразу пачку.</div>
        ) : (
          <div className="ads-tray-list">
            {selected.map((c) => (
              <div key={c.id} className="ads-tray-item">
                <Thumb seed={c.seed} url={c.url} />
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
/* Step 4 — Resize (region selection)                                  */
/* ------------------------------------------------------------------ */

function CropStage({ c, f, onChange }: { c: Creative; f: Format; onChange: (crop: Crop) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const crop = c.crops[f.id] ?? DEFAULT_CROP;
  const natAR = c.nw / c.nh;
  const fmtAR = f.w / f.h;
  const r = cropRect(natAR, fmtAR, crop);

  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const ccx = crop.cx;
    const ccy = crop.cy;
    const half = { x: r.nw / 2, y: r.nh / 2 };
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width;
      const dy = (ev.clientY - sy) / rect.height;
      onChange({ k: crop.k, cx: clamp(ccx + dx, half.x, 1 - half.x), cy: clamp(ccy + dy, half.y, 1 - half.y) });
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = ref.current!.getBoundingClientRect();
    const mv = (ev: PointerEvent) => {
      const pxN = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const pyN = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
      const kw = (Math.abs(pxN - crop.cx) * 2) / r.base.bw;
      const kh = (Math.abs(pyN - crop.cy) * 2) / r.base.bh;
      onChange({ ...crop, k: clamp(Math.max(kw, kh), 0.3, 1) });
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="ads-stage" ref={ref} style={{ aspectRatio: `${natAR}` }}>
      <div className="ads-stage-fallback" style={{ background: seedGradient(c.seed) }} />
      <div className="ads-stage-img" style={{ backgroundImage: `url(${assetFull(c)})` }} />
      <div
        className="ads-cropbox"
        style={{ left: `${r.nx * 100}%`, top: `${r.ny * 100}%`, width: `${r.nw * 100}%`, height: `${r.nh * 100}%` }}
        onPointerDown={startMove}
      >
        <span className="ads-cropbox-grid" />
        <span className="ads-cropbox-label">
          {f.w}×{f.h}
        </span>
        <span className="ads-crop-handle" onPointerDown={startResize} />
      </div>
    </div>
  );
}

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
        crops: Object.fromEntries(
          network.formats.map((f) => [f.id, { ...DEFAULT_CROP }] as [string, Crop]),
        ),
      })),
    );
  }
  function applyToAll(from: Creative) {
    const crop = from.crops[fmt.id] ?? DEFAULT_CROP;
    setSelected((prev) => prev.map((c) => ({ ...c, crops: { ...c.crops, [fmt.id]: { ...crop } } })));
  }
  return (
    <div className="ads-step-pad ads-fade">
      <div className="ads-resize-head">
        <SectionTitle
          title="Выберите область под формат сети"
          hint="Фото разной формы — рамкой задаёте нужный кадр. Тяните рамку, угол — размер."
        />
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
              <CropStage c={c} f={fmt} onChange={(nc) => setCrop(c.id, fmt.id, nc)} />
              <div className="ads-crop-tools">
                <IcZoom size={15} />
                <input
                  type="range"
                  min={0.3}
                  max={1}
                  step={0.01}
                  value={crop.k}
                  onChange={(e) => setCrop(c.id, fmt.id, { ...crop, k: parseFloat(e.target.value) })}
                />
                <button className="ads-mini-btn" onClick={() => setCrop(c.id, fmt.id, { ...DEFAULT_CROP })}>
                  Авто
                </button>
                <button className="ads-mini-btn" title="Применить ко всем фото" onClick={() => applyToAll(c)}>
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

/* ------------------------------------------------------------------ */
/* Step 5 — Texts: AI (open) + moderation + per-image text             */
/* ------------------------------------------------------------------ */

function StepTexts({
  network,
  primaryFormat,
  selected,
  aiPrompt,
  setAiPrompt,
  aiBusy,
  gen,
  generateAll,
  assign,
  assignAll,
  fillUnique,
  fillCard,
}: {
  network: Network;
  primaryFormat: Format;
  selected: Creative[];
  aiPrompt: string;
  setAiPrompt: (s: string) => void;
  aiBusy: boolean;
  gen: Record<string, string[]>;
  generateAll: () => void;
  assign: (id: string, key: string, value: string) => void;
  assignAll: (key: string, value: string) => void;
  fillUnique: () => void;
  fillCard: (id: string, index: number) => void;
}) {
  const [dropOn, setDropOn] = useState<string | null>(null);
  const hasGen = network.texts.some((t) => (gen[t.key]?.length ?? 0) > 0);

  function onDrop(e: React.DragEvent, id: string) {
    e.preventDefault();
    setDropOn(null);
    try {
      const d = JSON.parse(e.dataTransfer.getData("application/json")) as { key: string; value: string };
      if (d?.key) assign(id, d.key, d.value);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="ads-texts ads-fade">
      {/* AI panel — open by default */}
      <div className="ads-texts-left">
        <div className="ads-ai-panel">
          <div className="ads-ai-panel-head">
            <span className="ads-ai-orb">
              <IcWand size={15} />
            </span>
            AI-конструктор
            <span className="ads-ai-live">онлайн</span>
          </div>
          <p className="ads-ai-desc">
            Сеть <b>{network.name}</b> сама задаёт, что и какой длины генерировать.
          </p>
          <div className="ads-ai-tasks">
            {network.texts.map((t) => (
              <span key={t.key} className="ads-ai-task">
                {t.label} <i>≤{t.max}</i>
              </span>
            ))}
          </div>
          <textarea
            className="ads-ai-textarea"
            placeholder="Оффер: о чём текст? (подставили заголовок новости)"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <button className="ads-btn primary full" onClick={generateAll} disabled={aiBusy}>
            {aiBusy ? (
              <>
                <span className="ads-spinner" /> Генерация…
              </>
            ) : (
              <>
                <IcWand size={16} /> Сгенерировать варианты
              </>
            )}
          </button>

          {hasGen &&
            network.texts.map((t) =>
              gen[t.key]?.length ? (
                <div className="ads-gen-group" key={t.key}>
                  <div className="ads-gen-label">
                    {t.label} <i>перетащите на фото →</i>
                  </div>
                  <div className="ads-pool">
                    {gen[t.key].map((v, i) => (
                      <span
                        key={i}
                        className="ads-pool-chip"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("application/json", JSON.stringify({ key: t.key, value: v }))
                        }
                      >
                        <IcGrip size={13} />
                        <span className="ads-pool-text">{v}</span>
                        <i>{v.length}</i>
                        <button className="ads-pool-all" title="Применить всем" onClick={() => assignAll(t.key, v)}>
                          <IcLayers size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null,
            )}

          {hasGen && (
            <button className="ads-btn soft full" onClick={fillUnique}>
              <IcRefresh size={16} /> Заполнить все фото уникально
            </button>
          )}

          <div className="ads-mod">
            <div className="ads-mod-head">
              <IcShield size={15} /> Правила модерации · {network.name}
            </div>
            <ul className="ads-mod-list">
              {network.moderation.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <div className="ads-mod-foot">
              <IcCheck size={13} /> Учитываются в промте — AI не пишет очевидно запрещённое
            </div>
          </div>
        </div>
      </div>

      {/* Per-image editing */}
      <div className="ads-texts-right">
        <div className="ads-texts-right-head">
          <IcImage size={16} /> Свой текст для каждой картинки — впишите вручную или перетащите из AI
        </div>
        <div className="ads-assign-grid">
          {selected.map((c, idx) => {
            const t = network.texts.find((x) => x.kind === "title" && c.assigned[x.key]);
            const d = network.texts.find((x) => x.kind === "desc" && c.assigned[x.key]);
            return (
              <div
                key={c.id}
                className={`ads-assign-card${dropOn === c.id ? " dropping" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropOn(c.id);
                }}
                onDragLeave={() => setDropOn((p) => (p === c.id ? null : p))}
                onDrop={(e) => onDrop(e, c.id)}
              >
                <div className="ads-assign-media" style={{ aspectRatio: `${primaryFormat.w} / ${primaryFormat.h}` }}>
                  <Cropped c={c} f={primaryFormat} />
                  <div className="ads-assign-scrim" />
                  <div className="ads-assign-overlay">
                    {t && <div className="ads-ov-title plain">{c.assigned[t.key]}</div>}
                    {d && <div className="ads-ov-desc plain">{c.assigned[d.key]}</div>}
                  </div>
                  <button className="ads-card-ai" title="Сгенерировать уникально" onClick={() => fillCard(c.id, idx)}>
                    <IcWand size={14} />
                  </button>
                </div>
                <div className="ads-card-fields">
                  {network.texts.map((tr) => {
                    const val = c.assigned[tr.key] ?? "";
                    const ratio = val.length / tr.max;
                    const cc = ratio > 1 ? "over" : ratio > 0.85 ? "warn" : "ok";
                    return (
                      <div className="ads-cf" key={tr.key}>
                        <input
                          value={val}
                          placeholder={tr.label}
                          maxLength={tr.max + 20}
                          onChange={(e) => assign(c.id, tr.key, e.target.value)}
                        />
                        <span className={`ads-cf-count ${cc}`}>
                          {val.length}/{tr.max}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 6 — Review                                                     */
/* ------------------------------------------------------------------ */

function StepReview({
  network,
  primaryFormat,
  campaign,
  news,
  flow,
  selected,
  count,
}: {
  network: Network;
  primaryFormat: Format;
  campaign: Campaign;
  news: News;
  flow: Flow;
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

      <div className="ads-review-summary">
        <span>
          <IcMegaphone size={14} /> {campaign.name}
        </span>
        <span style={netVar(network.color)}>
          <span className="ads-dot" /> {network.name}
        </span>
        <span>
          <IcGlobe size={14} /> {news.title.slice(0, 30)}…
        </span>
        <span>
          <IcLink size={14} /> Поток {flow.id} · {flow.name}
        </span>
      </div>

      <div className="ads-review-grid">
        {selected.map((c) => {
          const title = network.texts.find((t) => t.kind === "title" && c.assigned[t.key]);
          const desc = network.texts.find((t) => t.kind === "desc" && c.assigned[t.key]);
          return (
            <div key={c.id} className="ads-review-card">
              <div className="ads-review-media" style={{ aspectRatio: `${primaryFormat.w} / ${primaryFormat.h}` }}>
                <Cropped c={c} f={primaryFormat} />
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
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
.ads-root{
  --violet:#6d5dfc; --violet-2:#8b7bff; --violet-soft:#eef0ff;
  --ink:#1c2434; --muted:#6b7280; --faint:#9aa3b2;
  --line:#ecedf3; --line-2:#f1f2f7; --bg:#f5f6fa; --card:#fff; --field:#f4f5f9;
  --ok:#16a34a; --warn:#f59e0b; --danger:#ef4444;
  --shadow:0 1px 2px rgba(16,24,40,.04), 0 10px 30px rgba(16,24,40,.05);
  display:flex; min-height:100vh; background:var(--bg); color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.ads-root *{box-sizing:border-box}
.ads-root button{font-family:inherit}

.ads-side{width:248px;flex-shrink:0;background:#fff;border-right:1px solid var(--line);
  display:flex;flex-direction:column;padding:20px 16px;position:sticky;top:0;height:100vh}
.ads-logo{display:flex;align-items:center;gap:10px;padding:4px 8px 18px}
.ads-logo-badge{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;
  font-size:13px;background:linear-gradient(135deg,#8b7bff,#6d5dfc);box-shadow:0 6px 14px rgba(109,93,252,.35)}
.ads-logo-text{font-weight:800;font-size:17px;letter-spacing:-.2px}
.ads-menu-label{font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--faint);text-transform:uppercase;padding:6px 10px}
.ads-nav{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.ads-nav-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;color:#525a6b;
  font-size:14.5px;font-weight:600;cursor:pointer;transition:.15s}
.ads-nav-item:hover{background:#f4f5f9;color:var(--ink)}
.ads-nav-item.active{background:linear-gradient(135deg,#7b6ef6,#6d5dfc);color:#fff;box-shadow:0 8px 20px rgba(109,93,252,.35)}
.ads-side-user{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px;border-top:1px solid var(--line)}
.ads-side-user-mail{font-size:13px;font-weight:700}
.ads-side-user-role{font-size:11.5px;color:var(--faint)}

.ads-main{flex:1;display:flex;flex-direction:column;min-width:0}
.ads-top{height:64px;flex-shrink:0;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 24px}
.ads-topsearch{flex:1;max-width:440px;display:flex;align-items:center;gap:10px;background:var(--field);
  border:1px solid transparent;border-radius:12px;padding:0 14px;height:42px;color:var(--faint)}
.ads-topsearch input{border:0;background:none;outline:none;flex:1;font-size:14px;color:var(--ink)}
.ads-topsearch:focus-within{border-color:var(--violet);background:#fff}
.ads-topright{margin-left:auto;display:flex;align-items:center;gap:14px}
.ads-icon-btn{width:38px;height:38px;border-radius:10px;border:0;background:transparent;color:#5a6271;display:grid;place-items:center;cursor:pointer;transition:.15s}
.ads-icon-btn:hover{background:var(--field);color:var(--ink)}
.ads-pill-all{font-size:11px;font-weight:800;letter-spacing:.1em;color:var(--violet);background:var(--violet-soft);padding:5px 9px;border-radius:8px}
.ads-top-mail{font-size:13.5px;color:#525a6b;font-weight:600}
.ads-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;background:linear-gradient(135deg,#8b7bff,#6d5dfc)}
.ads-avatar.sm{width:34px;height:34px;font-size:13px}

.ads-content{padding:26px 30px 60px;max-width:1340px;width:100%}
.ads-pagehead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap}
.ads-h1{font-size:26px;font-weight:800;letter-spacing:-.4px;margin:0}
.ads-sub{margin:6px 0 0;color:var(--muted);font-size:14.5px}
.ads-crumbs{display:flex;gap:8px;flex-wrap:wrap;max-width:680px;justify-content:flex-end}
.ads-crumb{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:999px;
  padding:7px 13px;font-size:13px;font-weight:600;color:#4a5365}
.ads-crumb .ads-dot{width:9px;height:9px;border-radius:50%;background:var(--net,#999)}
.ads-crumb-accent{background:var(--violet-soft);border-color:transparent;color:var(--violet)}

.ads-card{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}

.ads-stepper{display:flex;align-items:center;padding:18px 22px;border-bottom:1px solid var(--line-2);overflow-x:auto}
.ads-step-wrap{display:flex;align-items:center}
.ads-step{display:flex;align-items:center;gap:9px;background:none;border:0;cursor:pointer;padding:4px;white-space:nowrap}
.ads-step-dot{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;background:#eef0f4;color:var(--faint);transition:.2s}
.ads-step-label{font-size:13.5px;font-weight:700;color:var(--faint)}
.ads-step.active .ads-step-dot{background:linear-gradient(135deg,#7b6ef6,#6d5dfc);color:#fff;box-shadow:0 6px 16px rgba(109,93,252,.4)}
.ads-step.active .ads-step-label{color:var(--ink)}
.ads-step.done .ads-step-dot{background:#e6f7ef;color:var(--ok)}
.ads-step.done .ads-step-label{color:#3a4254}
.ads-step.locked{cursor:not-allowed}
.ads-step-line{width:26px;height:2px;background:#eaecf1;margin:0 6px;border-radius:2px;transition:.3s}
.ads-step-line.fill{background:linear-gradient(90deg,#16c2a3,#6d5dfc)}

.ads-body{min-height:460px}
.ads-step-pad{padding:26px}
.ads-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 26px;border-top:1px solid var(--line-2);background:#fcfcfe}
.ads-footer-meta{font-size:13.5px;color:var(--muted)} .ads-footer-meta b{color:var(--ink)}
.ads-footer-actions{display:flex;gap:10px;margin-left:auto}

.ads-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid transparent;border-radius:12px;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;transition:.16s;white-space:nowrap}
.ads-btn.primary{background:linear-gradient(135deg,#7b6ef6,#6d5dfc);color:#fff;box-shadow:0 8px 18px rgba(109,93,252,.32)}
.ads-btn.primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
.ads-btn.primary:disabled{background:#dfe2ea;color:#a7adba;box-shadow:none;cursor:not-allowed;transform:none}
.ads-btn.ghost{background:#fff;border-color:var(--line);color:#46506b}
.ads-btn.ghost:hover{background:var(--field);border-color:#dfe2ea}
.ads-btn.soft{background:var(--violet-soft);color:var(--violet)}
.ads-btn.soft:hover{background:#e6e8ff}
.ads-btn.sm{padding:8px 14px;font-size:13px;border-radius:10px}
.ads-btn.lg{padding:13px 22px;font-size:15px}
.ads-btn.full{width:100%;justify-content:center;margin-top:8px}

.ads-sectitle{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.ads-sectitle-n{width:28px;height:28px;border-radius:9px;background:var(--violet-soft);color:var(--violet);display:grid;place-items:center;font-weight:800;font-size:14px;flex-shrink:0}
.ads-sectitle-t{font-size:17px;font-weight:800;letter-spacing:-.2px}
.ads-sectitle-h{font-size:13.5px;color:var(--muted);margin-top:2px}

/* generic select */
.ads-sel{position:relative}
.ads-sel-btn{display:flex;align-items:center;gap:8px;width:100%;background:#fff;border:1.5px solid var(--line);border-radius:11px;
  padding:10px 12px;font-size:13.5px;font-weight:600;color:var(--ink);cursor:pointer;transition:.15s}
.ads-sel-btn:hover{border-color:#d8dbe6}
.ads-sel-btn.open{border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-soft)}
.ads-sel-btn .ph{color:var(--faint)}
.ads-sel-panel{position:absolute;top:calc(100% + 6px);left:0;right:0;min-width:160px;background:#fff;border:1px solid var(--line);
  border-radius:11px;box-shadow:0 18px 40px rgba(16,24,40,.16);padding:5px;z-index:40;max-height:260px;overflow:auto}
.ads-sel-opt{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:0;background:none;text-align:left;
  padding:9px 10px;border-radius:8px;font-size:13.5px;font-weight:600;color:#3a4254;cursor:pointer}
.ads-sel-opt:hover{background:var(--field)} .ads-sel-opt.sel{background:var(--violet-soft);color:var(--violet)}

/* dropdown (campaign) */
.ads-dd{position:relative;max-width:620px}
.ads-dd-trigger{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1.5px solid var(--line);
  border-radius:14px;padding:14px 16px;cursor:pointer;color:var(--ink);transition:.15s}
.ads-dd-trigger:hover{border-color:#d8dbe6}
.ads-dd-trigger.open{border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-dd-current{display:flex;align-items:center;gap:11px;min-width:0}
.ads-dd-name{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-dd-placeholder{display:flex;align-items:center;gap:10px;color:var(--faint);font-size:15px;font-weight:600}
.ads-dd-panel{position:absolute;top:calc(100% + 8px);left:0;right:0;background:#fff;border:1px solid var(--line);border-radius:14px;
  box-shadow:0 18px 50px rgba(16,24,40,.16);padding:6px;z-index:30}
.ads-dd-opt{width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:10px;border:0;background:none;cursor:pointer;text-align:left;transition:.12s}
.ads-dd-opt:hover{background:var(--field)} .ads-dd-opt.sel{background:var(--violet-soft)}
.ads-net-badge{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex-shrink:0;color:#fff;font-weight:800;font-size:11px;background:var(--net,#6d5dfc)}
.ads-status{margin-left:auto;font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:6px}
.ads-status.active{background:#e6f7ef;color:#16a34a} .ads-status.draft{background:#eef0f4;color:#6b7280} .ads-status.paused{background:#fff2e2;color:#d97706}
.ads-tag{font-size:11.5px;font-weight:700;color:#5a6271;background:#f0f1f6;padding:3px 8px;border-radius:6px}

.ads-net-block{margin-top:30px;padding-top:26px;border-top:1px dashed var(--line)}
.ads-net-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.ads-net-pill{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:9px 14px 9px 9px;
  font-size:14px;font-weight:700;color:#46506b;cursor:pointer;transition:.15s}
.ads-net-pill:hover{border-color:#d8dbe6}
.ads-net-pill.active{border-color:var(--net);color:var(--ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--net) 16%,transparent)}
.ads-net-pill .ads-net-badge{background:var(--net)}
.ads-net-specs{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ads-spec{background:var(--field);border-radius:14px;padding:16px}
.ads-spec-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:12px;color:#3a4254}
.ads-spec-chips{display:flex;flex-wrap:wrap;gap:8px}
.ads-chip-static{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:7px 11px;font-size:13px;font-weight:600}
.ads-chip-static i{font-style:normal;color:var(--faint);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-readybar{margin-top:18px;display:flex;align-items:center;gap:10px;background:#e9fbf3;color:#0f7a52;border-radius:12px;padding:13px 16px;font-size:14px;font-weight:600}
.ads-readybar b{color:#0a5e3f}

/* news */
.ads-news-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
.ads-news-toolbar .ads-sel{min-width:150px}
.ads-news-search{flex:1;min-width:220px;display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);border-radius:11px;padding:0 12px;height:42px;color:var(--faint)}
.ads-news-search input{flex:1;border:0;outline:none;background:none;font-size:14px;color:var(--ink)}
.ads-news-search:focus-within{border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-soft)}
.ads-seg{display:inline-flex;background:var(--field);border-radius:12px;padding:4px;gap:4px}
.ads-seg.sm button{padding:8px 14px;font-size:13px}
.ads-seg button{display:flex;align-items:center;gap:8px;border:0;background:none;padding:9px 16px;border-radius:9px;font-size:13.5px;font-weight:700;color:#6b7280;cursor:pointer;transition:.15s}
.ads-seg button.on{background:#fff;color:var(--ink);box-shadow:0 2px 6px rgba(16,24,40,.08)}
.ads-news-head{display:grid;grid-template-columns:80px 1fr 130px 110px 110px;gap:12px;padding:0 12px 8px;font-size:12px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line-2)}
.ads-news-list{display:flex;flex-direction:column}
.ads-news-row{display:grid;grid-template-columns:80px 1fr 130px 110px 110px;gap:12px;align-items:center;padding:10px 12px;border-radius:12px;cursor:pointer;border:1.5px solid transparent;transition:.13s}
.ads-news-row:hover{background:#fafbff}
.ads-news-row.sel{border-color:var(--violet);background:var(--violet-soft)}
.ads-news-thumb{position:relative;width:72px;height:50px;border-radius:8px;overflow:hidden;background:#e9ebf2}
.ads-news-thumb img{width:100%;height:100%;object-fit:cover}
.ads-news-play{position:absolute;inset:0;margin:auto;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;display:grid;place-items:center}
.ads-news-title{font-size:14px;font-weight:600;line-height:1.35}
.ads-news-cat{font-size:12px;font-weight:600;color:#5a6271;border:1px solid var(--line);border-radius:7px;padding:4px 9px}
.ads-news-status{font-size:12px;font-weight:700;color:#6b7280;border:1px solid var(--line);border-radius:7px;padding:4px 9px}
.ads-news-status.ok{color:#16a34a;border-color:#bfe8cf;background:#f1fbf5}
.ads-news-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.ads-na-btn{width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:#9aa3b2;display:grid;place-items:center;cursor:pointer;transition:.13s}
.ads-na-btn:hover{background:var(--field);color:#5a6271}
.ads-na-btn.star{color:#f5a623}
.ads-news-radio{width:22px;height:22px;border-radius:50%;border:2px solid #d3d7e2;display:grid;place-items:center;color:#fff}
.ads-news-radio.on{background:var(--violet);border-color:var(--violet)}
.ads-news-empty{padding:30px;text-align:center;color:var(--faint);font-size:14px}

/* flow */
.ads-flow-toolbar{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.ads-flow-toolbar label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:700;color:#3a4254}
.ads-flow-list{display:flex;flex-direction:column;gap:14px}
.ads-flow-card{border:1.5px solid var(--line);border-radius:16px;padding:16px;cursor:pointer;transition:.14s;background:#fff}
.ads-flow-card:hover{border-color:#d8dbe6}
.ads-flow-card.sel{border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-soft)}
.ads-flow-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.ads-flow-name{font-size:15px;color:#3a4254} .ads-flow-name b{font-weight:800;color:var(--ink)}
.ads-flow-pick{border:1.5px solid var(--line);background:#fff;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700;color:#46506b;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:.14s}
.ads-flow-pick:hover{border-color:var(--violet);color:var(--violet)}
.ads-flow-pick.on{background:var(--violet);border-color:var(--violet);color:#fff}
.ads-flow-urlrow{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.ads-flow-url{flex:1;background:var(--field);border-radius:10px;padding:11px 13px;font-size:12.5px;color:#46506b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-flow-copy{flex-shrink:0;border:1.5px solid #f3c0c0;background:#fff;color:#e5484d;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:.14s}
.ads-flow-copy:hover{background:#fff5f5}
.ads-flow-subs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:start}
.ads-flow-subs input{border:1.5px solid var(--line);border-radius:9px;padding:9px 10px;font-size:12.5px;color:var(--ink);background:#fff;width:100%}
.ads-flow-subs input:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-soft)}
.ads-flow-subs input.macro{color:var(--faint);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--field)}
.ads-flow-pixel{display:flex;flex-direction:column;gap:3px}
.ads-flow-pixel-note{font-size:10.5px;color:var(--faint)}
.ads-flow-note{display:flex;align-items:center;gap:7px;margin-top:12px;font-size:12px;color:var(--faint)}

/* photos */
.ads-photos{display:grid;grid-template-columns:1fr 280px;min-height:460px}
.ads-photos-main{padding:24px;min-width:0}
.ads-searchrow{display:flex;gap:10px;margin:18px 0}
.ads-searchbox{flex:1;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:0 14px;height:46px;color:var(--faint)}
.ads-searchbox:focus-within{border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-searchbox input{flex:1;border:0;outline:none;background:none;font-size:15px;color:var(--ink)}
.ads-empty{text-align:center;padding:30px 20px}
.ads-empty-ic{width:60px;height:60px;border-radius:16px;background:var(--field);color:var(--faint);display:grid;place-items:center;margin:0 auto 14px}
.ads-empty p{color:var(--muted);font-size:14.5px;margin:0 0 16px}
.ads-suggest{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.ads-suggest button{background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#46506b;cursor:pointer;transition:.15s}
.ads-suggest button:hover{border-color:var(--violet);color:var(--violet);background:var(--violet-soft)}
.ads-upload{margin:18px 0;border:2px dashed #d4d8e4;border-radius:16px;padding:34px 20px;text-align:center;cursor:pointer;transition:.16s;background:#fcfcff}
.ads-upload:hover{border-color:var(--violet);background:var(--violet-soft)}
.ads-upload.drag{border-color:var(--violet);background:var(--violet-soft);transform:scale(1.005)}
.ads-upload-ic{width:58px;height:58px;border-radius:16px;background:#fff;color:var(--violet);display:grid;place-items:center;margin:0 auto 12px;box-shadow:0 6px 16px rgba(109,93,252,.18)}
.ads-upload b{display:block;font-size:15px;margin-bottom:4px}
.ads-upload span{font-size:13px;color:var(--muted)}
.ads-up-hint{font-size:13px;color:var(--faint);text-align:center;margin:0 0 16px}
.ads-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:14px}
.ads-tile{position:relative;border:0;padding:0;background:none;cursor:pointer;border-radius:14px;overflow:hidden;text-align:left;box-shadow:0 0 0 1px var(--line);transition:.16s}
.ads-tile:hover{transform:translateY(-2px);box-shadow:0 0 0 1px var(--line),0 10px 22px rgba(16,24,40,.12)}
.ads-tile.sel{box-shadow:0 0 0 2.5px var(--violet),0 10px 22px rgba(109,93,252,.22)}
.ads-fav-btn{position:absolute;top:8px;left:8px;width:26px;height:26px;border-radius:8px;border:0;background:rgba(255,255,255,.92);color:#9aa3b2;display:grid;place-items:center;cursor:pointer;transition:.14s;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.ads-fav-btn:hover{color:#ec4899;transform:scale(1.08)}
.ads-fav-btn.on{color:#ec4899}
.ads-tile-cap{display:block;padding:9px 10px;background:#fff}
.ads-tile-cap b{display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-tile-cap i{font-style:normal;font-size:11px;color:var(--faint)}
.ads-tile-check{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:#fff;color:#cfd3dd;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.12);transition:.15s;transform:scale(.8);opacity:0}
.ads-tile:hover .ads-tile-check{opacity:1;transform:scale(1)}
.ads-tile.sel .ads-tile-check{opacity:1;transform:scale(1);background:var(--violet);color:#fff}
.ads-thumb,.ads-thumb-fallback{display:block;width:100%;aspect-ratio:1/1;position:relative}
.ads-thumb{overflow:hidden}
.ads-thumb-fallback{position:absolute;inset:0}
.ads-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}

.ads-tray{border-left:1px solid var(--line-2);background:#fcfcfe;padding:20px 16px;display:flex;flex-direction:column}
.ads-tray-head{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;margin-bottom:14px}
.ads-count{margin-left:auto;background:var(--violet);color:#fff;font-size:12px;font-weight:800;min-width:22px;height:22px;border-radius:11px;display:grid;place-items:center;padding:0 7px}
.ads-tray-empty{font-size:13px;color:var(--faint);line-height:1.5;background:#fff;border:1px dashed var(--line);border-radius:12px;padding:16px}
.ads-tray-list{display:flex;flex-direction:column;gap:8px;overflow:auto}
.ads-tray-item{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:11px;padding:7px}
.ads-tray-item .ads-thumb{width:40px;height:40px;border-radius:8px;flex-shrink:0}
.ads-tray-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.ads-tray-x{border:0;background:none;color:var(--faint);cursor:pointer;width:24px;height:24px;border-radius:6px;display:grid;place-items:center}
.ads-tray-x:hover{background:#fdeaea;color:var(--danger)}

/* resize */
.ads-resize-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ads-fmt-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 22px}
.ads-fmt-tab{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);border-radius:11px;padding:8px 14px 8px 10px;font-size:13.5px;font-weight:700;color:#46506b;cursor:pointer;transition:.15s}
.ads-fmt-tab:hover{border-color:#d8dbe6}
.ads-fmt-tab.on{border-color:var(--violet);color:var(--violet);background:var(--violet-soft)}
.ads-fmt-mini{width:22px;background:#cdd2de;border-radius:3px;max-height:22px}
.ads-fmt-tab.on .ads-fmt-mini{background:var(--violet)}
.ads-resize-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}
.ads-resize-card{background:var(--field);border-radius:14px;padding:12px}
.ads-resize-name{font-size:12.5px;font-weight:700;color:#46506b;margin-bottom:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ads-stage{position:relative;width:100%;overflow:hidden;border-radius:10px;background:#0d0f14;user-select:none;max-height:360px;margin:0 auto;touch-action:none}
.ads-stage-fallback,.ads-stage-img{position:absolute;inset:0}
.ads-stage-img{background-size:cover;background-position:center;background-repeat:no-repeat}
.ads-cropbox{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.5);cursor:move;touch-action:none}
.ads-cropbox-grid{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,transparent 33.2%,rgba(255,255,255,.4) 33.2%,rgba(255,255,255,.4) 33.5%,transparent 33.5%,transparent 66.5%,rgba(255,255,255,.4) 66.5%,rgba(255,255,255,.4) 66.8%,transparent 66.8%),
  linear-gradient(0deg,transparent 33.2%,rgba(255,255,255,.4) 33.2%,rgba(255,255,255,.4) 33.5%,transparent 33.5%,transparent 66.5%,rgba(255,255,255,.4) 66.5%,rgba(255,255,255,.4) 66.8%,transparent 66.8%)}
.ads-cropbox-label{position:absolute;top:5px;left:5px;background:rgba(0,0,0,.6);color:#fff;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-crop-handle{position:absolute;right:-8px;bottom:-8px;width:16px;height:16px;background:#fff;border:2.5px solid var(--violet);border-radius:4px;cursor:nwse-resize;box-shadow:0 2px 5px rgba(0,0,0,.3)}
.ads-crop-tools{display:flex;align-items:center;gap:8px;margin-top:10px;color:var(--faint)}
.ads-crop-tools input[type=range]{flex:1}
.ads-mini-btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 9px;font-size:12px;font-weight:700;color:#46506b;cursor:pointer;transition:.15s}
.ads-mini-btn:hover{border-color:var(--violet);color:var(--violet)}
.ads-root input[type=range]{-webkit-appearance:none;appearance:none;height:5px;border-radius:5px;background:#e2e5ec;outline:none}
.ads-root input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--violet);cursor:pointer;box-shadow:0 2px 6px rgba(109,93,252,.5);border:2px solid #fff}
.ads-root input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--violet);cursor:pointer;border:2px solid #fff}

.ads-crop-fallback{position:absolute;inset:0}
.ads-cropped{position:absolute;inset:0}

/* texts */
.ads-texts{display:grid;grid-template-columns:380px 1fr;min-height:460px}
.ads-texts-left{padding:22px;border-right:1px solid var(--line-2);overflow:auto;background:#fcfcfe}
.ads-ai-panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:0 6px 20px rgba(16,24,40,.05)}
.ads-ai-panel-head{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:800}
.ads-ai-orb{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#8b7bff,#6d5dfc);box-shadow:0 5px 12px rgba(109,93,252,.4)}
.ads-ai-live{margin-left:auto;font-size:10.5px;font-weight:800;letter-spacing:.06em;color:#16a34a;background:#e9fbf3;padding:3px 8px;border-radius:6px;text-transform:uppercase}
.ads-ai-desc{font-size:13px;color:var(--muted);margin:10px 0 10px}
.ads-ai-tasks{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}
.ads-ai-task{font-size:12px;font-weight:700;color:var(--violet);background:var(--violet-soft);border-radius:8px;padding:5px 9px}
.ads-ai-task i{font-style:normal;opacity:.7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-ai-textarea{width:100%;min-height:64px;resize:vertical;border:1.5px solid var(--line);border-radius:11px;padding:11px 13px;font-size:13.5px;font-family:inherit;color:var(--ink)}
.ads-ai-textarea:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 4px var(--violet-soft)}
.ads-gen-group{margin-top:14px}
.ads-gen-label{font-size:12.5px;font-weight:700;color:#3a4254;margin-bottom:7px;display:flex;justify-content:space-between}
.ads-gen-label i{font-style:normal;font-weight:600;color:var(--faint);font-size:11.5px}
.ads-pool{display:flex;flex-wrap:wrap;gap:7px}
.ads-pool-chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:5px 7px 5px 8px;font-size:12.5px;font-weight:600;color:#3a4254;cursor:grab;max-width:100%;transition:.15s}
.ads-pool-chip:hover{border-color:var(--violet);box-shadow:0 4px 10px rgba(109,93,252,.14)}
.ads-pool-chip:active{cursor:grabbing}
.ads-pool-chip>svg:first-child{color:var(--faint);flex-shrink:0}
.ads-pool-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.ads-pool-chip i{font-style:normal;font-size:11px;color:var(--faint);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-pool-all{border:0;background:none;cursor:pointer;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;color:var(--faint);flex-shrink:0}
.ads-pool-all:hover{background:var(--violet-soft);color:var(--violet)}
.ads-mod{margin-top:16px;border:1px solid #e7ecf7;background:#f7f9fe;border-radius:12px;padding:13px}
.ads-mod-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:#3a4254}
.ads-mod-list{margin:9px 0 8px;padding-left:18px;display:flex;flex-direction:column;gap:5px}
.ads-mod-list li{font-size:12.5px;color:#5a6271;line-height:1.35}
.ads-mod-foot{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#16a34a;background:#e9fbf3;border-radius:8px;padding:7px 10px}

.ads-texts-right{padding:22px;overflow:auto}
.ads-texts-right-head{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:#46506b;margin-bottom:16px}
.ads-assign-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.ads-assign-card{border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px var(--line);transition:.16s}
.ads-assign-card.dropping{box-shadow:0 0 0 2.5px var(--violet),0 12px 26px rgba(109,93,252,.25);transform:translateY(-2px)}
.ads-assign-media{position:relative;overflow:hidden;background:#000}
.ads-assign-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 30%,rgba(0,0,0,.72))}
.ads-assign-overlay{position:absolute;left:0;right:0;bottom:0;padding:12px;display:flex;flex-direction:column;gap:4px}
.ads-ov-title{color:#fff;font-weight:800;font-size:15px;line-height:1.25;text-shadow:0 1px 4px rgba(0,0,0,.4)}
.ads-ov-desc{color:rgba(255,255,255,.92);font-size:12.5px;line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,.4)}
.ads-card-ai{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:9px;border:0;background:rgba(255,255,255,.92);color:var(--violet);display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:.14s}
.ads-card-ai:hover{background:#fff;transform:scale(1.07)}
.ads-card-fields{padding:10px;display:flex;flex-direction:column;gap:7px}
.ads-cf{position:relative;display:flex;align-items:center}
.ads-cf input{width:100%;border:1.5px solid var(--line);border-radius:9px;padding:8px 48px 8px 10px;font-size:12.5px;color:var(--ink)}
.ads-cf input:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-soft)}
.ads-cf-count{position:absolute;right:9px;font-size:10.5px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ads-cf-count.ok{color:var(--faint)} .ads-cf-count.warn{color:var(--warn)} .ads-cf-count.over{color:var(--danger)}

/* review */
.ads-review-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.ads-review-stats{display:flex;gap:10px}
.ads-rstat{background:var(--field);border-radius:12px;padding:10px 18px;text-align:center;min-width:74px}
.ads-rstat b{display:block;font-size:22px;font-weight:800;line-height:1} .ads-rstat span{font-size:11.5px;color:var(--muted);font-weight:600}
.ads-rstat.accent{background:var(--violet-soft)} .ads-rstat.accent b{color:var(--violet)}
.ads-review-summary{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}
.ads-review-summary span{display:inline-flex;align-items:center;gap:7px;background:var(--field);border-radius:999px;padding:7px 13px;font-size:13px;font-weight:600;color:#46506b}
.ads-review-summary .ads-dot{width:9px;height:9px;border-radius:50%;background:var(--net,#999)}
.ads-review-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;margin-top:18px}
.ads-review-card{border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px var(--line)}
.ads-review-media{position:relative;overflow:hidden;background:#000}
.ads-review-net{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:11px;font-weight:800;color:#fff;background:var(--net,#6d5dfc);box-shadow:0 2px 6px rgba(0,0,0,.25)}
.ads-review-foot{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;font-size:12.5px;font-weight:600;color:#46506b}
.ads-review-fmts{color:var(--faint);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

/* success + toast */
.ads-success{position:relative;text-align:center;padding:56px 26px 64px;overflow:hidden}
.ads-success-orb{width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#16c2a3,#0fb892);color:#fff;display:grid;place-items:center;margin:0 auto 22px;box-shadow:0 14px 34px rgba(16,194,163,.45);animation:pop .4s ease}
.ads-success h2{font-size:26px;font-weight:800;margin:0 0 8px;letter-spacing:-.4px}
.ads-success p{color:var(--muted);font-size:15px;max-width:420px;margin:0 auto 26px;line-height:1.5}
.ads-success-actions{display:flex;gap:12px;justify-content:center}
.ads-confetti{position:absolute;inset:0;pointer-events:none}
.ads-confetti span{position:absolute;top:-12px;width:9px;height:9px;border-radius:2px;opacity:.9;animation:confetti 1.5s linear infinite}
.ads-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:flex;align-items:center;gap:9px;background:#1c2434;color:#fff;font-size:14px;font-weight:600;padding:12px 18px;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.3);z-index:200}
.ads-toast svg{color:#34e0a1}

.skeleton{background:linear-gradient(90deg,#eef0f4 25%,#f6f7fa 37%,#eef0f4 63%);background-size:400% 100%;animation:shimmer 1.3s infinite;border-radius:14px;aspect-ratio:1/1;box-shadow:none}
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
  .ads-net-specs,.ads-flow-toolbar{grid-template-columns:1fr 1fr}
  .ads-flow-subs{grid-template-columns:repeat(3,1fr)}
  .ads-news-head,.ads-news-row{grid-template-columns:64px 1fr 90px}
  .ads-news-head span:nth-child(4),.ads-news-head span:nth-child(5),
  .ads-news-row>div:nth-child(4){display:none}
}
`;
