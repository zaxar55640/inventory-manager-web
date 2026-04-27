import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {apiUrl} from './config';

// ── types ─────────────────────────────────────────────────────────────────────

type Supplier = {
  supplier_name: string;
  items_count: number;
  total_to_order: number;
  coverage_days?: number | null;
  lead_time_days: number;
  order_cycle_days: number;
  moq_qty?: number | null;
};

type Recommendation = {
  id: number;
  supplier_name: string;
  sku_name: string;
  item_ref: string;
  norm_name: string;
  available_qty: number;
  in_transit_qty: number;
  to_order: number;
  recommended_stock: number;
  demand_mode: string;
  abc_class: string;
  xyz_class: string;
  coverage_days: number;
  coverage_source: string;
  system_note: string;
  lead_time_days: number;
  order_cycle_days: number;
  cycle_stock: number;
  safety_stock: number;
  pre_season_flag: number;
  peak_months: string;
  explain_text: string;
  status: string;
};

type DraftSummary = {id: number; supplier_name: string; status: string; created_at: string; draft_mode: 'single' | 'multi'; items_count: number; total_qty: number};
type OrderBatch = {id: number; supplier_name: string; status: string; created_at: string; items_count: number; total_qty: number};
type DraftItem = {id: number; recommendation_id: number; item_ref: string; sku_name: string; norm_name: string; recommended_qty: number; manager_qty: number; final_qty: number; reason: string};
type DraftDetail = {batch: DraftSummary; items: DraftItem[]};
type OrderDetail = {batch: {id: number; supplier_name: string; status: string; created_at: string}; items: Array<{id: number; sku_name: string; item_ref: string; recommended_qty: number; manager_qty: number; final_qty: number; reason: string; item_status: string}>};
type NonLiquidItem = {store: string; store_ref: string; item_ref: string; sku_name: string; norm_name: string; subgroup: string; available_qty: number; sales_qty_4m: number; last_sale_date: string | null; days_since_last_sale: number | null; is_seasonal: number; season_note: string | null; nlq_score: number | null};
type NonLiquidResponse = {items: NonLiquidItem[]; total: number; limit: number; offset: number; has_more: boolean};
type Dashboard = {total_to_order: number; urgent_count: number; pre_season_count: number; overstock_count: number; new_items_count: number};
type Decision = {decision_date: string; manager_name: string; sku_name: string; system_qty: number; manager_qty: number; delta_qty: number; reason: string; supplier_name: string};

type CatalogItem = {
  sku_name: string; item_ref: string; barcode: string | null;
  subgroup: string | null; available_qty: number;
  supplier_name: string | null; to_order: number | null; status: string | null;
  pre_season_flag: number; peak_months: string | null;
  abc_class: string | null; xyz_class: string | null; explain_text: string | null;
  last_sale_date: string | null; days_since_last_sale: number | null;
  is_seasonal: number | null; season_note: string | null; nlq_score: number | null;
};
type CatalogResponse = {items: CatalogItem[]; total: number; limit: number; offset: number; has_more: boolean};

type Catalog2Item = {
  id: number; item_code: string|null; item_name: string; barcode: string|null;
  qty: number; reserve: number; retail_price: number; purchase_price: number;
  parent_name: string|null; variant: string|null;
  group_l0: string|null; group_l1: string|null; group_l2: string|null;
  group_l3: string|null; group_l4: string|null; group_l5: string|null;
  group_l6: string|null; group_l7: string|null; group_l8: string|null;
  group_depth: number; group_full_path: string|null;
  last_sale_date: string|null; days_since_last_sale: number|null;
  abc_class: string|null; xyz_class: string|null;
  forecast_day_matrix: number|null; forecast_to_order: number|null;
  forecast_mode: string|null; w_forecast_final: number|null;
};
type C2GroupResult = {name: string; depth: number; item_count: number; path: string};
type C2Forecast = {
  item_code: string; calc_date: string;
  avg_day_365: number; avg_day_30: number; std_day_no_anom: number; observed_days_365: number;
  week_same_2024: number; week_same_2025: number; week_next_2024: number; week_next_2025: number;
  month_coef_1: number; month_coef_2: number; month_coef_3: number; month_coef_4: number;
  month_coef_5: number; month_coef_6: number; month_coef_7: number; month_coef_8: number;
  month_coef_9: number; month_coef_10: number; month_coef_11: number; month_coef_12: number;
  peak_months: number[];
  anomaly_days_count_365: number; anomaly_prob_day: number; anomaly_excess_avg: number;
  abc_class: string; xyz_class: string;
  d_base: number; w_base: number; w_season: number;
  k_month: number; k_month_clip: number;
  w_forecast_core: number; w_anom_adj: number; w_forecast_final: number; forecast_day_matrix: number;
  ss_base: number; ss_anom: number; ss_total: number;
  lead_time_days: number; order_cycle_days: number;
  recommended_stock: number; to_order: number;
  demand_mode: string; total_net_sales_365: number;
  anomaly_dates?: {sale_date: string; net_qty: number}[];
  anomaly_threshold?: number;
};
type C2TreeNode = {name: string; item_count: number};
type C2TreeEntry = {children: C2TreeNode[]; directItems: number};
type C2Gran = 'day' | 'week' | 'month';
type C2SalesSeries = {period: string; sales: number; returns: number};
type C2SalesData = {series: C2SalesSeries[]; has_data: boolean; gran: C2Gran};
type Catalog2Response = {items: Catalog2Item[]; total: number; limit: number; offset: number; has_more: boolean};


type C2AnalyticsSegment = {
  level: 'group'|'subgroup'; path: string; name: string; sku_count: number; active_sku: number; no_sales_sku: number; dead_stock_sku: number;
  qty_total: number; stock_value_purchase: number; stock_value_retail: number; sales_qty_30: number; sales_qty_365: number;
  coverage_days: number|null; avg_days_since_last_sale: number|null; healthy_status: string; alert: string|null;
};
type C2AnalyticsSummary = {
  overview: {
    total_sku: number; active_sku: number; no_sales_sku: number; dead_stock_sku: number;
    qty_total: number; stock_value_retail: number; stock_value_purchase: number;
    total_sales_qty_30: number; total_sales_qty_365: number; coverage_days: number|null;
    active_share: number; no_sales_share: number; dead_stock_share: number;
  };
  segments: C2AnalyticsSegment[];
  problem_zones: { overstock: C2AnalyticsSegment[]; dead_stock: C2AnalyticsSegment[]; deficit: C2AnalyticsSegment[]; };
  recommendations: { title: string; text: string; severity: 'high'|'medium'|'low'; }[];
};

type AnalyticsAction = {
  title: string;
  text: string;
  severity: 'high'|'medium'|'low';
};

type AnalyticsSegmentBucket = {
  label: string;
  tone: string;
  items: C2AnalyticsSegment[];
};

// ── new analytics types ───────────────────────────────────────────────────────
type ASegment = { count: number; value: number };
type AnalyticsSummary = {
  segments: { normal: ASegment; overstock_only: ASegment; nlq_only: ASegment; both: ASegment };
  pre_season_count: number; total_with_stock: number; total_stock_value: number;
};
type AnalyticsSaleRow = { year: number; month: number; net_qty: number; revenue: number };
type AnalyticsSupplier = {
  supplier_name: string; items_with_stock: number;
  nlq_count: number; nlq_value: number; nlq_pct: number;
  overstock_count: number; overstock_value: number; os_pct: number;
  both_count: number; total_value: number;
  abc_a_count: number; xyz_x_count: number; pre_season_count: number; score: number;
};
type AnalyticsDrillItem = {
  id: number; item_code: string|null; item_name: string; barcode: string|null;
  qty: number; purchase_price: number; retail_price: number;
  parent_name: string|null; group_l0: string|null; group_full_path: string|null;
  forecast_day_matrix: number|null; abc_class: string|null; xyz_class: string|null;
  forecast_to_order: number|null; last_sale_date: string|null;
  days_since_last_sale: number|null; coverage_days: number|null;
};

type CreateMode = 'single' | 'multi';
type TabKey = 'create' | 'drafts' | 'orders' | 'nonLiquid' | 'decisions' | 'catalog' | 'catalog2' | 'analytics';

const currency = new Intl.NumberFormat('ru-RU');
const num = (v: unknown, fallback = '—') => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ru-RU') : fallback);
const normalizeCatalogPath = (path: string) => path.split('/').map(s => s.trim()).filter(Boolean).join(' / ');

// ── helpers ───────────────────────────────────────────────────────────────────

function getTabFromLocation(): TabKey {
  const hash = (window.location.hash || '').replace(/^#/, '').replace(/\/$/, '');
  if (hash === '/non-liquid' || hash === 'non-liquid') return 'nonLiquid';
  if (hash === '/drafts' || hash === 'drafts') return 'drafts';
  if (hash === '/orders' || hash === 'orders') return 'orders';
  if (hash === '/decisions' || hash === 'decisions') return 'decisions';
  if (hash === '/catalog' || hash === 'catalog') return 'catalog';
  if (hash === '/catalog2' || hash === 'catalog2') return 'catalog2';
  if (hash === '/catalog-analytics' || hash === 'catalog-analytics') return 'analytics';
  if (hash === '/analytics' || hash === 'analytics') return 'analytics';
  return 'create';
}

function navigateToTab(tab: TabKey) {
  const map: Record<TabKey, string> = {
    nonLiquid: '#/non-liquid',
    drafts: '#/drafts',
    orders: '#/orders',
    decisions: '#/decisions',
    catalog: '#/catalog',
    catalog2: '#/catalog2',
    analytics: '#/analytics',
    create: '#/',
  };
  window.location.hash = map[tab];
}

/** Traffic-light indicator for a recommendation row */
function StatusDot({status}: {status: string}) {
  const cfg: Record<string, {bg: string; label: string}> = {
    urgent_order:                {bg: '#ef4444', label: 'Срочно'},
    pre_season_order:            {bg: '#f59e0b', label: 'Предсезон'},
    order:                       {bg: '#eab308', label: 'Заказать'},
    limited_history_manual_check:{bg: '#3b82f6', label: 'Проверить'},
    new_item_manual_check:       {bg: '#8b5cf6', label: 'Новый'},
    ok:                          {bg: '#22c55e', label: 'ОК'},
    overstock_risk:              {bg: '#f97316', label: 'Перестой'},
  };
  const c = cfg[status] || {bg: '#94a3b8', label: status};
  return (
    <span
      title={c.label}
      style={{
        display: 'inline-block',
        width: 14, height: 14, borderRadius: '50%',
        background: c.bg, flexShrink: 0, marginTop: 2,
      }}
    />
  );
}

/** ABC/XYZ badge */
const ABC_TIPS: Record<string, string> = {
  A: 'A — топ 70% по выручке. Высокий приоритет закупки.',
  B: 'B — следующие 20% по выручке. Средний приоритет.',
  C: 'C — нижние 10% по выручке. Низкий приоритет, заказывать осторожно.',
};
const XYZ_TIPS: Record<string, string> = {
  X: 'X — стабильный спрос (CV < 0.5). Прогноз надёжен.',
  Y: 'Y — умеренная волатильность (CV 0.5–1.0). Прогноз приблизителен.',
  Z: 'Z — нестабильный / сезонный спрос (CV ≥ 1.0). Высокий буфер страховки.',
};
function ClassBadge({abc, xyz}: {abc: string; xyz: string}) {
  const abcColor: Record<string, string> = {A: '#22c55e', B: '#eab308', C: '#94a3b8'};
  const xyzColor: Record<string, string> = {X: '#22c55e', Y: '#f59e0b', Z: '#ef4444'};
  return (
    <span style={{display: 'inline-flex', gap: 3, fontSize: '0.72em'}}>
      {abc && <span title={ABC_TIPS[abc] || abc} style={{background: abcColor[abc] || '#ccc', color: '#fff', borderRadius: 3, padding: '1px 5px', fontWeight: 700, cursor: 'help'}}>{abc}</span>}
      {xyz && <span title={XYZ_TIPS[xyz] || xyz} style={{background: xyzColor[xyz] || '#ccc', color: '#fff', borderRadius: 3, padding: '1px 5px', fontWeight: 700, cursor: 'help'}}>{xyz}</span>}
    </span>
  );
}

// ── catalog2: seasonality bars ────────────────────────────────────────────────

const RU_MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function SeasonBars({coefs, peak, currentMonth}: {coefs: number[]; peak: number[]; currentMonth?: number}) {
  const [hoverM, setHoverM] = useState<number | null>(null);
  const W = 320, H = 82, PB = 18;
  const ph = H - PB;
  const barW = W / 12;
  const maxC = Math.max(...coefs, 1.4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: 'auto', display: 'block'}}>
      {coefs.map((c, i) => {
        const m = i + 1;
        const isPeak = peak.includes(m);
        const isCur = m === currentMonth;
        const isHov = m === hoverM;
        const bH = Math.max(2, (c / maxC) * ph);
        const x = i * barW;
        const barFill = isCur ? '#22c55e' : isPeak ? '#f59e0b' : c > 1.0 ? '#3b82f6' : '#334155';
        return (
          <g key={m} onMouseEnter={() => setHoverM(m)} onMouseLeave={() => setHoverM(null)} style={{cursor: 'default'}}>
            {(isPeak || isCur) && <rect x={x} y={0} width={barW} height={H} fill={isCur ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.07)'}/>}
            <rect x={x + 1} y={ph - bH} width={barW - 2} height={bH}
              fill={barFill} opacity={isHov ? 1 : 0.82} rx={2}/>
            {isCur && <rect x={x + 1} y={ph - bH} width={barW - 2} height={bH} fill="none" stroke="#22c55e" strokeWidth={0.8} rx={2}/>}
            <text x={x + barW / 2} y={H - 3} textAnchor="middle" fontSize={7.5}
              fill={isCur ? '#22c55e' : isPeak ? '#f59e0b' : '#475569'} fontWeight={isCur ? 700 : 400}>{RU_MONTHS[i]}</text>
            {isHov && (
              <text x={x + barW / 2} y={Math.max(10, ph - bH - 3)} textAnchor="middle" fontSize={8}
                fill={barFill} fontWeight="bold">{c.toFixed(2)}</text>
            )}
          </g>
        );
      })}
      <line x1={0} y1={ph - (1 / maxC) * ph} x2={W} y2={ph - (1 / maxC) * ph}
        stroke="#22c55e" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.6}/>
    </svg>
  );
}

// ── catalog2: line chart helpers ──────────────────────────────────────────────

function periodMonth(period: string, gran: C2Gran): number {
  if (gran === 'day' || gran === 'month') return parseInt(period.slice(5, 7), 10) || 0;
  const m = period.match(/\d{4}-W(\d+)/);
  if (!m) return 0;
  return Math.min(12, Math.max(1, Math.ceil(parseInt(m[1]) / 4.33)));
}

function fmtPeriod(period: string | undefined | null, gran: C2Gran): string {
  if (!period) return '—';
  try {
    if (gran === 'day') {
      const m = parseInt(period.slice(5, 7), 10) - 1;
      return `${period.slice(8)} ${RU_MONTHS[m] ?? ''}`;
    }
    if (gran === 'week') {
      return `${period.slice(5)} '${period.slice(2, 4)}`;
    }
    const m = parseInt(period.slice(5, 7), 10) - 1;
    return `${RU_MONTHS[m] ?? ''} '${period.slice(2, 4)}`;
  } catch { return period; }
}

function SalesLineChart({series, gran, peakMonths, forecastDayMatrix}: {series: C2SalesSeries[]; gran: C2Gran; peakMonths?: number[]; forecastDayMatrix?: number}) {
  const [zoomRange, setZoomRange] = useState<[number,number] | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCur, setDragCur] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!series.length) {
    return (
      <div style={{textAlign: 'center', color: '#475569', padding: '36px 0', fontSize: '0.88em'}}>
        Данных о продажах пока нет
      </div>
    );
  }

  const W = 640, H = 210, PL = 52, PR = 16, PT = 28, PB = 38;
  const pw = W - PL - PR, ph = H - PT - PB;

  const displayed = zoomRange ? series.slice(zoomRange[0], zoomRange[1] + 1) : series;
  const zoomOffset = zoomRange ? zoomRange[0] : 0;
  const n = displayed.length;

  const maxSales = Math.max(...displayed.map(s => s.sales), 1);
  const maxRet   = Math.max(...displayed.map(s => s.returns), 0);
  const forecastPerPeriod = forecastDayMatrix != null
    ? gran === 'day' ? forecastDayMatrix
    : gran === 'week' ? forecastDayMatrix * 7
    : forecastDayMatrix * 30.4
    : null;
  const maxY = Math.max(maxSales, maxRet, forecastPerPeriod ?? 0, 1);

  const xOf = (i: number) => PL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const yOf = (v: number) => PT + ph - Math.max(0, Math.min(1, v / maxY)) * ph;

  function clientToDisplayIdx(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || n <= 1) return 0;
    const svgX = (clientX - rect.left) / rect.width * W;
    const frac = Math.max(0, Math.min(1, (svgX - PL) / pw));
    return Math.round(frac * (n - 1));
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const idx = clientToDisplayIdx(e.clientX);
    setHoverIdx(idx);
    if (dragStart !== null) setDragCur(idx);
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    e.preventDefault();
    const idx = clientToDisplayIdx(e.clientX);
    setDragStart(idx);
    setDragCur(idx);
  }

  function onMouseUp() {
    if (dragStart !== null && dragCur !== null) {
      const a = Math.min(dragStart, dragCur);
      const b = Math.max(dragStart, dragCur);
      if (b - a >= 2) {
        setZoomRange([zoomOffset + a, zoomOffset + b]);
        setHoverIdx(null);
      }
    }
    setDragStart(null);
    setDragCur(null);
  }

  function onMouseLeave() {
    setHoverIdx(null);
    setDragStart(null);
    setDragCur(null);
  }

  const salesPts = displayed.map((s, i) => `${xOf(i).toFixed(1)},${yOf(s.sales).toFixed(1)}`).join(' ');
  const retPts   = displayed.map((s, i) => `${xOf(i).toFixed(1)},${yOf(s.returns).toFixed(1)}`).join(' ');
  const salesArea = [
    `M ${xOf(0).toFixed(1)},${(PT + ph).toFixed(1)}`,
    ...displayed.map((s, i) => `L ${xOf(i).toFixed(1)},${yOf(s.sales).toFixed(1)}`),
    `L ${xOf(n - 1).toFixed(1)},${(PT + ph).toFixed(1)} Z`,
  ].join(' ');

  const labelStep = n <= 14 ? 1 : n <= 31 ? 2 : n <= 60 ? 5 : n <= 90 ? 7 : n <= 180 ? 14 : n <= 365 ? 30 : 52;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const showDots = n <= 60;

  const hoverItem = hoverIdx !== null ? displayed[hoverIdx] : null;
  const hoverX = hoverIdx !== null ? xOf(hoverIdx) : null;
  const tooltipLeft = hoverX !== null && hoverX > W - 140;

  const dragA = dragStart !== null && dragCur !== null ? Math.min(dragStart, dragCur) : null;
  const dragB = dragStart !== null && dragCur !== null ? Math.max(dragStart, dragCur) : null;

  return (
    <div style={{position: 'relative', userSelect: 'none'}}>
      {zoomRange && (
        <button
          onClick={() => { setZoomRange(null); setHoverIdx(null); }}
          style={{
            position: 'absolute', top: 0, right: 0, padding: '2px 8px',
            background: '#334155', border: 'none', borderRadius: 4, color: '#94a3b8',
            cursor: 'pointer', fontSize: '0.72em', zIndex: 10,
          }}
        >↔ Сброс зума</button>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{width: '100%', height: 'auto', display: 'block', cursor: dragStart !== null ? 'col-resize' : 'crosshair'}}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        <defs>
          <linearGradient id="c2sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.28}/>
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
          </linearGradient>
        </defs>

        {/* Y grid */}
        {yTicks.map(t => {
          const y = PT + ph * (1 - t);
          return (
            <g key={t}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={t === 0 ? '#334155' : '#1e293b'} strokeWidth={t === 0 ? 1 : 0.6}/>
              <text x={PL - 5} y={y + 3.5} fontSize={8.5} textAnchor="end" fill="#475569">
                {Math.round(maxY * t)}
              </text>
            </g>
          );
        })}

        {/* Peak month bands (all granularities) */}
        {peakMonths && peakMonths.length > 0 && displayed.map((s, i) => {
          if (!s.period) return null;
          const m = periodMonth(s.period, gran);
          if (!peakMonths.includes(m)) return null;
          const x = xOf(i);
          const step = n > 1 ? pw / (n - 1) : pw;
          return <rect key={i} x={x - step / 2} y={PT} width={step} height={ph} fill="rgba(245,158,11,0.09)"/>;
        })}

        {/* Drag selection highlight */}
        {dragA !== null && dragB !== null && dragA !== dragB && (
          <rect
            x={xOf(dragA)} y={PT}
            width={Math.max(0, xOf(dragB) - xOf(dragA))} height={ph}
            fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.35)" strokeWidth={0.8}
          />
        )}

        {/* Area fill */}
        <path d={salesArea} fill="url(#c2sg)"/>

        {/* Returns line */}
        {maxRet > 0 && (
          <polyline points={retPts} fill="none" stroke="#ef4444" strokeWidth={1.5}
            strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 2"/>
        )}

        {/* Sales line */}
        <polyline points={salesPts} fill="none" stroke="#3b82f6" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round"/>

        {/* Dots */}
        {showDots && displayed.map((s, i) => (
          <g key={i}>
            <circle
              cx={xOf(i)} cy={yOf(s.sales)}
              r={hoverIdx === i ? 4.5 : (n <= 30 ? 2.5 : 1.8)}
              fill={hoverIdx === i ? '#93c5fd' : '#3b82f6'}
              stroke="#0f172a" strokeWidth={1}
            />
            {s.returns > 0 && (
              <circle
                cx={xOf(i)} cy={yOf(s.returns)}
                r={hoverIdx === i ? 3.5 : 2}
                fill={hoverIdx === i ? '#fca5a5' : '#ef4444'}
                stroke="#0f172a" strokeWidth={1}
              />
            )}
          </g>
        ))}

        {/* X labels */}
        {displayed.map((s, i) => {
          if (i % labelStep !== 0 && i !== n - 1) return null;
          if (i === n - 1 && n > 1 && (n - 1) % labelStep < labelStep * 0.5) return null;
          return (
            <text key={i} x={xOf(i)} y={H - 4} fontSize={8} textAnchor="middle" fill="#475569">
              {fmtPeriod(s.period, gran)}
            </text>
          );
        })}

        {/* Hover crosshair + tooltip */}
        {hoverIdx !== null && hoverX !== null && hoverItem && (
          <>
            <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + ph}
              stroke="#475569" strokeWidth={0.8} strokeDasharray="3 2"/>
            {(() => {
              const tW = 126, tH = maxRet > 0 ? 52 : 38;
              const tX = tooltipLeft ? hoverX - tW - 8 : hoverX + 8;
              const tY = Math.max(PT, Math.min(PT + ph - tH, yOf(hoverItem.sales) - tH / 2));
              return (
                <g>
                  <rect x={tX} y={tY} width={tW} height={tH} rx={4}
                    fill="#1e293b" stroke="#334155" strokeWidth={0.8}/>
                  <text x={tX + 8} y={tY + 13} fontSize={8.5} fill="#64748b">
                    {fmtPeriod(hoverItem.period, gran)}
                  </text>
                  <text x={tX + 8} y={tY + 27} fontSize={10} fill="#93c5fd" fontWeight="bold">
                    {hoverItem.sales.toLocaleString('ru-RU')} прод.
                  </text>
                  {maxRet > 0 && (
                    <text x={tX + 8} y={tY + 42} fontSize={9} fill="#fca5a5">
                      {hoverItem.returns.toLocaleString('ru-RU')} возвр.
                    </text>
                  )}
                </g>
              );
            })()}
          </>
        )}

        {/* Forecast reference line */}
        {forecastPerPeriod != null && forecastPerPeriod > 0 && (
          <>
            <line x1={PL} y1={yOf(forecastPerPeriod)} x2={W - PR} y2={yOf(forecastPerPeriod)}
              stroke="#f59e0b" strokeWidth={1} strokeDasharray="5 3" opacity={0.7}/>
            <text x={W - PR - 4} y={yOf(forecastPerPeriod) - 4} fontSize={7.5} textAnchor="end"
              fill="#f59e0b" opacity={0.85}>прогноз</text>
          </>
        )}

        {/* Legend */}
        <line x1={PL} y1={10} x2={PL + 16} y2={10} stroke="#3b82f6" strokeWidth={2}/>
        <circle cx={PL + 8} cy={10} r={2} fill="#3b82f6"/>
        <text x={PL + 20} y={13.5} fontSize={9} fill="#94a3b8">Продажи</text>
        {maxRet > 0 && (
          <>
            <line x1={PL + 68} y1={10} x2={PL + 84} y2={10} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2"/>
            <text x={PL + 88} y={13.5} fontSize={9} fill="#94a3b8">Возвраты</text>
          </>
        )}
        {!zoomRange && n > 8 && (
          <text x={W - PR} y={13.5} fontSize={7} textAnchor="end" fill="#1e293b">
            выделите мышью для зума
          </text>
        )}
      </svg>
    </div>
  );
}

// ── catalog2: product detail modal ────────────────────────────────────────────

const C2_PRESETS = [
  {label: '3 мес', months: 3},
  {label: '6 мес', months: 6},
  {label: '1 год', months: 12},
  {label: '2024+', months: 0},
];

const DEMAND_MODE_LABELS: Record<string, {label: string; color: string}> = {
  normal:           {label: 'Стабильный',        color: '#22c55e'},
  short_history:    {label: 'Короткая история',   color: '#3b82f6'},
  limited_history:  {label: 'Ограниченная история', color: '#f59e0b'},
  new_no_history:   {label: 'Новый товар',         color: '#8b5cf6'},
};

function ProductDetailModal2({
  item, onClose, salesData, salesLoading, chartFrom, chartTo, chartGran,
  setChartFrom, setChartTo, setChartGran,
  forecastData, forecastLoading,
}: {
  item: Catalog2Item; onClose: () => void;
  salesData: C2SalesData | null; salesLoading: boolean;
  chartFrom: string; chartTo: string; chartGran: C2Gran;
  setChartFrom: (v: string) => void; setChartTo: (v: string) => void; setChartGran: (v: C2Gran) => void;
  forecastData: C2Forecast | null; forecastLoading: boolean;
}) {
  const [forecastDays, setForecastDays] = useState(forecastData?.order_cycle_days ?? 14);
  useEffect(() => {
    setForecastDays(forecastData?.order_cycle_days ?? 14);
  }, [forecastData?.item_code]);
  const profit = item.retail_price - item.purchase_price;
  const margin = item.retail_price > 0 ? (profit / item.retail_price * 100) : 0;
  const pathParts = item.group_full_path ? item.group_full_path.split(' / ') : [];

  function applyPreset(months: number) {
    const now = new Date();
    const to = now.toISOString().slice(0, 7);
    if (months === 0) { setChartFrom('2024-01'); setChartTo(to); return; }
    const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    setChartFrom(from.toISOString().slice(0, 7));
    setChartTo(to);
  }

  const totalSales = (salesData?.series || []).reduce((a, s) => a + s.sales, 0);
  const totalReturns = (salesData?.series || []).reduce((a, s) => a + s.returns, 0);
  const periodCount = salesData?.series?.length || 0;
  const avgSalesPerPeriod = periodCount > 0 ? totalSales / periodCount : 0;
  const peakSalesPoint = salesData?.series?.length
    ? salesData.series.reduce((best, point) => point.sales > best.sales ? point : best, salesData.series[0])
    : null;
  const zeroPeriods = (salesData?.series || []).filter(point => (point.sales || 0) === 0).length;
  const activePeriods = Math.max(0, periodCount - zeroPeriods);
  const activeShare = periodCount > 0 ? Math.round((activePeriods / periodCount) * 100) : 0;

  return (
    <div
      style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40, overflowY: 'auto'}}
      onClick={onClose}
    >
      <div
        style={{background: '#1e293b', borderRadius: 18, padding: '28px 30px', width: '97%', maxWidth: 1280, boxShadow: '0 18px 80px rgba(0,0,0,.6)', marginBottom: 40}}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 22, alignItems: 'flex-start'}}>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontSize: '0.88em', color: '#64748b', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}} title={item.group_full_path || ''}>
              {pathParts.slice(1).join(' › ')}
            </div>
            <div style={{fontWeight: 800, fontSize: '1.5em', color: '#f8fafc', lineHeight: 1.25}}>{item.item_name}</div>
            <div style={{display: 'flex', gap: 14, marginTop: 8, fontSize: '0.95em', color: '#94a3b8', flexWrap: 'wrap'}}>
              {item.item_code && <span>Код: <span style={{fontFamily: 'monospace', color: '#e2e8f0'}}>{item.item_code.trim()}</span></span>}
              {item.barcode && <span>ШК: <span style={{fontFamily: 'monospace', color: '#e2e8f0'}}>{item.barcode}</span></span>}
              {item.variant && <span>Вариант: <span style={{color: '#e2e8f0'}}>{item.variant}</span></span>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{background: '#0f172a', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', cursor: 'pointer', padding: '8px 14px', fontSize: '1.05em', flexShrink: 0}}
          >✕</button>
        </div>

        {/* Info cards */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24}}>
          {[
            {label: 'Остаток', value: item.qty > 0 ? item.qty.toLocaleString('ru-RU') + ' шт.' : '—', color: item.qty > 0 ? '#22c55e' : '#ef4444'},
            {label: 'Резерв', value: item.reserve > 0 ? item.reserve.toLocaleString('ru-RU') : '—', color: '#f8fafc'},
            {label: 'Цена продажи', value: item.retail_price > 0 ? item.retail_price.toLocaleString('ru-RU') + ' ₽' : '—', color: '#f8fafc'},
            {label: `Маржа ${margin.toFixed(0)}%`, value: profit > 0 ? profit.toLocaleString('ru-RU') + ' ₽' : '—', color: margin > 30 ? '#22c55e' : margin > 10 ? '#f59e0b' : '#ef4444'},
          ].map(({label, value, color}) => (
            <div key={label} style={{background: '#0f172a', borderRadius: 12, padding: '14px 16px', minHeight: 88, display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
              <div style={{fontSize: '0.86em', color: '#64748b', marginBottom: 6}}>{label}</div>
              <div style={{fontWeight: 800, color, fontSize: '1.28em', lineHeight: 1.15}}>{value}</div>
            </div>
          ))}
        </div>

        {/* Chart + forecast: two columns */}
        <div style={{display: 'flex', gap: 20, alignItems: 'flex-start'}}>
          <div style={{flex: 1, minWidth: 0}}>
        {/* Chart section */}
        <div style={{background: '#0f172a', borderRadius: 14, padding: '20px 22px'}}>
          {/* Title + stats */}
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10}}>
            <div style={{fontWeight: 700, fontSize: '1.12em', color: '#f8fafc'}}>
              Динамика продаж
              {salesData?.has_data && (
                <span style={{fontWeight: 500, color: '#94a3b8', marginLeft: 10, fontSize: '0.94em'}}>
                  {totalSales.toLocaleString('ru-RU')} прод. · {totalReturns} возвр.
                  {salesData.series.length > 0 && (
                    <span style={{marginLeft: 6, color: '#334155'}}>({salesData.series.length} {salesData.gran === 'day' ? 'дней' : salesData.gran === 'week' ? 'недель' : 'мес.'})</span>
                  )}
                </span>
              )}
            </div>
            {/* Granularity toggle */}
            <div style={{display: 'flex', gap: 4, background: '#1e293b', borderRadius: 9, padding: 3}}>
              {(['day','week','month'] as C2Gran[]).map(g => (
                <button key={g} onClick={() => setChartGran(g)} style={{
                  padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.88em', fontWeight: 700,
                  background: chartGran === g ? '#2563eb' : 'transparent',
                  color: chartGran === g ? '#fff' : '#64748b',
                  transition: 'background .15s',
                }}>
                  {g === 'day' ? 'Дни' : g === 'week' ? 'Недели' : 'Месяцы'}
                </button>
              ))}
            </div>
          </div>

          {/* Date range + presets */}
          <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap'}}>
            <div style={{display: 'flex', gap: 3}}>
              {C2_PRESETS.map(p => (
                <button key={p.label} onClick={() => applyPreset(p.months)} style={{
                  padding: '5px 10px', borderRadius: 7, border: '1px solid #334155', cursor: 'pointer',
                  background: '#1e293b', color: '#94a3b8', fontSize: '0.84em', fontWeight: 600,
                }}>{p.label}</button>
              ))}
            </div>
            <label style={{display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9em', color: '#94a3b8'}}>
              от
              <input type="month" value={chartFrom} onChange={e => setChartFrom(e.target.value)}
                style={{background: '#1e293b', border: '1px solid #334155', borderRadius: 7, color: '#f8fafc', padding: '5px 9px', fontSize: '0.98em'}}
              />
            </label>
            <label style={{display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9em', color: '#94a3b8'}}>
              до
              <input type="month" value={chartTo} onChange={e => setChartTo(e.target.value)}
                style={{background: '#1e293b', border: '1px solid #334155', borderRadius: 7, color: '#f8fafc', padding: '5px 9px', fontSize: '0.98em'}}
              />
            </label>
          </div>

          {/* Chart */}
          {salesLoading
            ? <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '36px 0', justifyContent: 'center', color: '#475569', fontSize: '0.88em'}}>
                <div className="spinner" style={{width: 16, height: 16}}/> Загрузка...
              </div>
            : <SalesLineChart
                series={salesData?.series || []}
                gran={salesData?.gran ?? chartGran}
                peakMonths={forecastData?.peak_months}
                forecastDayMatrix={forecastData?.forecast_day_matrix}
              />
          }

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 16}}>
            {[
              {label: 'Среднее за период', value: `${avgSalesPerPeriod.toLocaleString('ru-RU', {maximumFractionDigits: 1})} шт.`, tone: '#f8fafc'},
              {label: salesData?.gran === 'day' ? 'Дней без продаж' : salesData?.gran === 'week' ? 'Недель без продаж' : 'Месяцев без продаж', value: `${zeroPeriods}`, tone: zeroPeriods > 0 ? '#f59e0b' : '#22c55e'},
              {label: 'Активных периодов', value: `${activePeriods} / ${periodCount || 0} · ${activeShare}%`, tone: '#60a5fa'},
              {label: 'Пик продаж', value: peakSalesPoint ? `${peakSalesPoint.sales} шт.` : '—', tone: '#22c55e', sub: peakSalesPoint ? String(peakSalesPoint.label ?? peakSalesPoint.date ?? '') : undefined},
            ].map(card => (
              <div key={card.label} style={{background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '12px 14px', minHeight: 92}}>
                <div style={{fontSize: '0.88em', color: '#94a3b8', marginBottom: 6}}>{card.label}</div>
                <div style={{fontSize: '1.15em', fontWeight: 800, color: card.tone, lineHeight: 1.2}}>{card.value}</div>
                {card.sub && <div style={{fontSize: '0.88em', color: '#64748b', marginTop: 6}}>{card.sub}</div>}
              </div>
            ))}
          </div>

          <div style={{marginTop: 12, background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '14px 16px', color: '#cbd5e1', fontSize: '0.98em', lineHeight: 1.55}}>
            {periodCount > 0
              ? activeShare < 35
                ? 'Спрос редкий: большая часть периодов пустая, поэтому важно смотреть не только пики, но и длинные промежутки без продаж.'
                : activeShare < 70
                ? 'Спрос умеренно прерывистый: продажи есть регулярно, но заметная часть периодов остаётся пустой.'
                : 'Спрос достаточно ровный: продажи присутствуют в большинстве периодов, график можно читать как стабильный паттерн.'
              : 'По выбранному диапазону пока нет данных для интерпретации.'}
          </div>
        </div>
          </div>{/* /chart column */}

          <div style={{width: 460, flexShrink: 0}}>
        {/* Forecast section */}
        {forecastLoading
          ? <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '28px 0', justifyContent: 'center', color: '#475569', fontSize: '0.88em'}}>
              <div className="spinner" style={{width: 16, height: 16}}/> Загрузка прогноза...
            </div>
          : forecastData
            ? (() => {
                const f = forecastData;
                const dm = DEMAND_MODE_LABELS[f.demand_mode] || {label: f.demand_mode, color: '#94a3b8'};
                const coefs = Array.from({length: 12}, (_, i) => (f as any)[`month_coef_${i + 1}`] as number);
                const r2 = (v: number) => Math.round(v * 100) / 100;
                const fmt1 = (v: number) => v.toLocaleString('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1});

                // Dynamic recalculation: запас на forecastDays дней после получения + срок доставки
                const dayRate = f.forecast_day_matrix;
                const dynStock = dayRate * (f.lead_time_days + forecastDays) + f.ss_total;
                const dynOrder = Math.max(0, Math.ceil(dynStock - item.qty));
                const coverageDays = dayRate > 0 ? Math.round(item.qty / dayRate) : null;

                const wBaseDir = f.w_season > f.w_base ? '↑' : f.w_season < f.w_base ? '↓' : '=';
                const wBaseDirColor = f.w_season > f.w_base ? '#22c55e' : f.w_season < f.w_base ? '#f59e0b' : '#64748b';

                // Trend: 30d vs 365d rate
                const trendRatio = f.avg_day_365 > 0 ? f.avg_day_30 / f.avg_day_365 : 1;
                const trendUp = trendRatio > 1.2;
                const trendDown = trendRatio < 0.8;
                const trendColor = trendUp ? '#22c55e' : trendDown ? '#ef4444' : '#94a3b8';
                const trendLabel = trendUp ? `↑ +${((trendRatio - 1) * 100).toFixed(0)}%`
                                 : trendDown ? `↓ −${((1 - trendRatio) * 100).toFixed(0)}%`
                                 : '≈ норма';

                // Stale forecast
                const calcAge = Math.round((Date.now() - new Date(f.calc_date).getTime()) / 86400000);
                const staleColor = calcAge > 14 ? '#ef4444' : calcAge > 7 ? '#f59e0b' : null;

                return (
                  <div style={{background: '#0f172a', borderRadius: 14, padding: '20px', marginTop: 0}}>

                    {/* Header */}
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10}}>
                      <span style={{fontWeight: 700, fontSize: '1.06em', color: '#f8fafc'}}>
                        Прогноз закупки
                        <span style={{fontSize: '0.9em', fontWeight: 500, color: '#94a3b8', marginLeft: 10}}>
                          {f.calc_date}
                          {calcAge > 3 && (
                            <span style={{marginLeft: 5, padding: '0 5px', borderRadius: 3, fontSize: '0.88em',
                              background: staleColor ? staleColor + '22' : 'transparent',
                              color: staleColor || '#475569'}}>
                              {calcAge} дн. назад{calcAge > 14 ? ' ⚠' : ''}
                            </span>
                          )}
                          {' · '}продаж за год: {Math.round(f.total_net_sales_365)} шт.
                        </span>
                      </span>
                      <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
                        <ClassBadge abc={f.abc_class} xyz={f.xyz_class}/>
                        <span style={{background: dm.color + '22', color: dm.color, borderRadius: 6, padding: '4px 9px', fontSize: '0.86em', fontWeight: 700, border: `1px solid ${dm.color}44`}}>{dm.label}</span>
                      </div>
                    </div>

                    {/* Demand metrics: 4 cards */}
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14}}>
                      {[
                        {label: 'Ср./день', sub: 'за 365 дн.', val: `${fmt1(f.avg_day_365)} шт.`, color: '#94a3b8'},
                        {label: 'Ср./день', sub: `за 30 дн. · ${trendLabel}`, val: `${fmt1(f.avg_day_30)} шт.`, color: trendColor},
                        {label: 'Сезонный', sub: `нед. ${new Date(f.calc_date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}`, val: `${fmt1(f.w_season)} шт.`, color: wBaseDirColor},
                        {label: 'Прогноз', sub: 'в неделю итого', val: `${fmt1(f.w_forecast_final)} шт.`, color: '#60a5fa'},
                      ].map(c => (
                        <div key={c.label} style={{background: '#0a1628', borderRadius: 10, padding: '12px 13px', minHeight: 96}}>
                          <div style={{fontSize: '0.88em', color: '#94a3b8', marginBottom: 4}}>{c.label}</div>
                          <div style={{fontSize: '0.78em', color: '#64748b', marginBottom: 8, lineHeight: 1.35}}>{c.sub}</div>
                          <div style={{fontWeight: 800, color: c.color, fontSize: '1.18em', lineHeight: 1.15}}>{c.val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Explanation of base vs seasonal */}
                    <div style={{fontSize: '0.96em', color: '#cbd5e1', background: '#0a1628', borderRadius: 10, padding: '12px 14px', marginBottom: 16, lineHeight: 1.7}}>
                      <span style={{color: '#94a3b8', fontWeight: 600}}>Базовый</span> = среднее за год × 7 дн.{' '}
                      <span style={{color: '#94a3b8', fontWeight: 600}}>Сезонный</span> = факт. продажи на этой / следующей неделе в 2024–2025 гг.{' '}
                      Множитель месяца: ×{f.k_month_clip.toFixed(2)}
                      {f.k_month_clip !== 1 && <span style={{color: f.k_month_clip > 1 ? '#22c55e' : '#f59e0b'}}> ({f.k_month_clip > 1 ? '+' : ''}{((f.k_month_clip - 1) * 100).toFixed(0)}% от среднего)</span>}.{' '}
                      {f.w_anom_adj > 0.1 && <span>Поправка на всплески: <span style={{color: '#f87171'}}>+{fmt1(f.w_anom_adj)} шт./нед.</span>{' '}</span>}
                      {f.w_season > f.w_base
                        ? <span style={{color: '#22c55e'}}>Сейчас активнее среднего — сезон.</span>
                        : f.w_season < f.w_base * 0.9
                        ? <span style={{color: '#f59e0b'}}>Сейчас тише среднего.</span>
                        : <span style={{color: '#475569'}}>Близко к среднему.</span>
                      }
                    </div>

                    {/* Order horizon + recommendation */}
                    <div style={{background: '#0a1628', borderRadius: 10, padding: '14px 16px', marginBottom: 16}}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap'}}>
                        <span style={{fontSize: '0.96em', color: '#cbd5e1'}}>Запас на</span>
                        <input
                          type="number" min={1} max={365}
                          value={forecastDays}
                          onChange={e => setForecastDays(Math.max(1, Math.min(365, Number(e.target.value) || 14)))}
                          style={{width: 72, padding: '6px 10px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#f8fafc', fontSize: '1em', textAlign: 'center', fontWeight: 700}}
                        />
                        <span style={{fontSize: '0.96em', color: '#cbd5e1'}}>дней после получения <span style={{color: '#94a3b8'}}>(+ {f.lead_time_days} дн. доставки)</span></span>
                        {coverageDays !== null && (
                          <span style={{fontSize: '0.78em', color: '#475569'}}>
                            · Текущий запас:{' '}
                            <span style={{fontWeight: 700, color: coverageDays < f.lead_time_days ? '#ef4444' : coverageDays < forecastDays ? '#f59e0b' : '#22c55e'}}>
                              {coverageDays} дн.
                            </span>
                            {coverageDays < f.lead_time_days && <span style={{color: '#ef4444'}}> ⚠</span>}
                          </span>
                        )}
                      </div>
                      <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}>
                        <div>
                          <div style={{fontSize: '0.68em', color: '#475569'}}>Нужно остатков</div>
                          <div style={{fontWeight: 600, color: '#94a3b8'}}>{fmt1(dynStock)} шт.</div>
                          <div style={{fontSize: '0.6em', color: '#334155'}}>вкл. страховой {fmt1(f.ss_total)} шт.</div>
                        </div>
                        <div style={{color: '#1e293b', fontSize: '1.2em'}}>−</div>
                        <div>
                          <div style={{fontSize: '0.68em', color: '#475569'}}>Есть сейчас</div>
                          <div style={{fontWeight: 600, color: '#64748b'}}>{item.qty.toLocaleString('ru-RU')} шт.</div>
                        </div>
                        <div style={{flex: 1}}/>
                        <div style={{textAlign: 'center', background: dynOrder > 0 ? '#052e16' : '#0f172a', borderRadius: 10, padding: '10px 18px', border: `1px solid ${dynOrder > 0 ? '#16a34a' : '#1e293b'}`}}>
                          <div style={{fontSize: '0.86em', color: '#94a3b8'}}>Заказать</div>
                          <div style={{fontWeight: 800, fontSize: '2.05em', color: dynOrder > 0 ? '#22c55e' : '#334155', lineHeight: 1}}>{dynOrder}</div>
                          <div style={{fontSize: '0.82em', color: '#94a3b8'}}>
                            шт.{dynOrder > 0 && item.purchase_price > 0 ? ` · ≈ ${(dynOrder * item.purchase_price).toLocaleString('ru-RU')} ₽` : ''}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Seasonality */}
                    <div style={{marginBottom: 14}}>
                      <div style={{fontSize: '0.96em', color: '#e2e8f0', marginBottom: 8, fontWeight: 700}}>
                        Сезонность
                        {f.peak_months.length > 0
                          ? <span style={{color: '#f59e0b', marginLeft: 6, fontWeight: 400}}>
                              пик: {f.peak_months.map(m => RU_MONTHS[m - 1]).join(', ')}
                            </span>
                          : <span style={{color: '#334155', marginLeft: 6, fontWeight: 400}}>пиков нет</span>
                        }
                      </div>
                      <SeasonBars coefs={coefs} peak={f.peak_months} currentMonth={new Date().getMonth() + 1}/>
                      {/* Week comparison 2024 vs 2025 */}
                      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8}}>
                        {[
                          {label: `Эта неделя (${new Date(f.calc_date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})})`, v24: f.week_same_2024, v25: f.week_same_2025},
                          {label: 'Следующая неделя', v24: f.week_next_2024, v25: f.week_next_2025},
                        ].map(row => (
                          <div key={row.label} style={{background: '#0a1628', borderRadius: 7, padding: '8px 10px'}}>
                            <div style={{fontSize: '0.68em', color: '#475569', marginBottom: 5}}>{row.label}</div>
                            <div style={{display: 'flex', gap: 12}}>
                              <div>
                                <div style={{fontSize: '0.62em', color: '#334155'}}>2024</div>
                                <div style={{fontWeight: 600, color: '#64748b', fontSize: '0.9em'}}>{row.v24 > 0 ? `${Math.round(row.v24)} шт.` : '—'}</div>
                              </div>
                              <div>
                                <div style={{fontSize: '0.62em', color: '#334155'}}>2025</div>
                                <div style={{fontWeight: 600, color: row.v25 > row.v24 ? '#22c55e' : '#94a3b8', fontSize: '0.9em'}}>{row.v25 > 0 ? `${Math.round(row.v25)} шт.` : '—'}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Anomaly section */}
                    {f.anomaly_days_count_365 > 0 && (
                      <div>
                        <div style={{fontSize: '0.96em', color: '#e2e8f0', fontWeight: 700, marginBottom: 8}}>
                          Аномальные продажи
                          <span style={{color: '#94a3b8', fontWeight: 500, marginLeft: 8}}>
                            {f.anomaly_days_count_365} {f.anomaly_days_count_365 === 1 ? 'день' : 'дней'} за год · порог: {r2(f.anomaly_threshold ?? (f.avg_day_365 + 3 * f.std_day_no_anom))} шт./день
                          </span>
                        </div>
                        {f.anomaly_dates && f.anomaly_dates.length > 0
                          ? <div style={{display: 'flex', flexDirection: 'column', gap: 3}}>
                              {f.anomaly_dates.map(d => (
                                <div key={d.sale_date} style={{display: 'flex', justifyContent: 'space-between', background: '#0a1628', borderRadius: 5, padding: '5px 10px', fontSize: '0.8em'}}>
                                  <span style={{color: '#64748b'}}>{new Date(d.sale_date).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'})}</span>
                                  <span style={{fontWeight: 700, color: '#f87171'}}>{d.net_qty} шт.</span>
                                </div>
                              ))}
                            </div>
                          : <div style={{fontSize: '0.78em', color: '#334155'}}>Загрузка дат…</div>
                        }
                      </div>
                    )}
                  </div>
                );
              })()
            : <div style={{padding: '12px 0', color: '#334155', fontSize: '0.82em', textAlign: 'center'}}>
                Прогноз не рассчитан — нет продаж за последний год
              </div>
        }
          </div>{/* /forecast column */}
        </div>{/* /two-column flex */}
      </div>
    </div>
  );
}

// ── explain modal ─────────────────────────────────────────────────────────────

function ExplainModal({row, onClose}: {row: Recommendation; onClose: () => void}) {
  const parts = row.explain_text ? row.explain_text.split(' | ') : [];
  return (
    <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'}} onClick={onClose}>
      <div style={{background: '#1e293b', borderRadius: 12, padding: '28px 32px', maxWidth: 420, width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,.5)'}} onClick={e => e.stopPropagation()}>
        <div style={{fontSize: '0.75em', color: '#94a3b8', marginBottom: 6}}>Почему такое количество?</div>
        <div style={{fontWeight: 700, fontSize: '1.05em', marginBottom: 18, color: '#f1f5f9'}}>{row.sku_name}</div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {parts.map((p, i) => {
            const [label, value] = p.includes(':') ? p.split(/:\s(.+)/) : [p, ''];
            return (
              <div key={i} style={{display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: 8}}>
                <span style={{color: '#94a3b8', fontSize: '0.9em'}}>{label}</span>
                <span style={{color: '#f1f5f9', fontWeight: 600, fontSize: '0.9em'}}>{value || '—'}</span>
              </div>
            );
          })}
        </div>
        {row.pre_season_flag === 1 && (
          <div style={{marginTop: 16, background: '#422006', color: '#fcd34d', borderRadius: 8, padding: '8px 12px', fontSize: '0.85em'}}>
            ⚡ Предсезонный заказ — пик продаж: месяцы {row.peak_months}
          </div>
        )}
        <button style={{marginTop: 20, width: '100%', padding: '10px 0', borderRadius: 8, background: '#334155', color: '#f1f5f9', border: 'none', cursor: 'pointer', fontSize: '1em'}} onClick={onClose}>Ясно</button>
      </div>
    </div>
  );
}

// ── edit qty modal (pencil button → opens qty + reason together) ──────────────

function EditQtyModal({item, onConfirm, onCancel}: {
  item: DraftItem;
  onConfirm: (qty: number, comment: string) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(String(item.manager_qty));
  const [comment, setComment] = useState(item.reason || '');
  const hints = ['Поставщик везёт дольше обычного', 'Избыток на складе', 'Сезон заканчивается', 'Договорились с поставщиком об акции', 'Своё видение по спросу'];
  const newQty = Number(qty);
  const qtyChanged = newQty !== item.recommended_qty;
  const reasonRequired = qtyChanged;
  const valid = !isNaN(newQty) && newQty >= 0 && (!reasonRequired || comment.trim().length >= 3);

  return (
    <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'}} onClick={onCancel}>
      <div style={{background: '#1e293b', borderRadius: 12, padding: '28px 32px', maxWidth: 440, width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,.5)'}} onClick={e => e.stopPropagation()}>
        <div style={{fontSize: '0.75em', color: '#94a3b8', marginBottom: 4}}>Изменить количество</div>
        <div style={{fontWeight: 700, fontSize: '1em', color: '#f1f5f9', marginBottom: 16}}>{item.sku_name}</div>
        <div style={{display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16}}>
          <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
            <span style={{fontSize: '0.8em', color: '#94a3b8'}}>Система рекомендует</span>
            <span style={{fontSize: '1.2em', fontWeight: 700, color: '#64748b'}}>{item.recommended_qty} шт</span>
          </label>
          <span style={{color: '#475569', fontSize: '1.4em'}}>→</span>
          <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
            <span style={{fontSize: '0.8em', color: '#94a3b8'}}>Ваше количество</span>
            <input
              autoFocus
              type="number"
              min={0}
              value={qty}
              onChange={e => setQty(e.target.value)}
              style={{width: 90, padding: '8px 12px', borderRadius: 8, border: `1px solid ${qtyChanged ? (newQty < item.recommended_qty ? '#ef4444' : '#22c55e') : '#334155'}`, background: '#0f172a', color: '#f1f5f9', fontSize: '1.1em', fontWeight: 700}}
            />
          </label>
        </div>
        {qtyChanged && (
          <>
            <label style={{display: 'block', fontSize: '0.85em', color: '#94a3b8', marginBottom: 6}}>
              Причина изменения <span style={{color: '#ef4444'}}>*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Почему меняете количество?"
              rows={2}
              style={{width: '100%', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#f1f5f9', padding: '8px 12px', fontSize: '0.9em', resize: 'none', boxSizing: 'border-box'}}
            />
            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8}}>
              {hints.map(h => (
                <button key={h} onClick={() => setComment(h)}
                  style={{padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: '#0f172a', color: '#94a3b8', cursor: 'pointer', fontSize: '0.75em'}}>
                  {h}
                </button>
              ))}
            </div>
          </>
        )}
        {!qtyChanged && (
          <div style={{marginBottom: 8}}>
            <label style={{display: 'block', fontSize: '0.85em', color: '#94a3b8', marginBottom: 6}}>Комментарий (необязательно)</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Добавьте комментарий если нужно…"
              rows={2}
              style={{width: '100%', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#f1f5f9', padding: '8px 12px', fontSize: '0.9em', resize: 'none', boxSizing: 'border-box'}}
            />
          </div>
        )}
        <div style={{display: 'flex', gap: 10, marginTop: 16}}>
          <button onClick={onCancel} style={{flex: 1, padding: '10px 0', borderRadius: 8, background: '#334155', color: '#f1f5f9', border: 'none', cursor: 'pointer'}}>Отмена</button>
          <button onClick={() => valid && onConfirm(newQty, comment.trim())} disabled={!valid}
            style={{flex: 2, padding: '10px 0', borderRadius: 8, background: valid ? '#2563eb' : '#1e293b', color: valid ? '#fff' : '#475569', border: 'none', cursor: valid ? 'pointer' : 'not-allowed', fontWeight: 700}}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── supplier settings row ─────────────────────────────────────────────────────

function SupplierSettings({supplier, onSave}: {supplier: Supplier; onSave: (s: Partial<Supplier>) => void}) {
  const [lt, setLt] = useState(String(supplier.lead_time_days ?? 7));
  const [oc, setOc] = useState(String(supplier.order_cycle_days ?? 7));
  const [moq, setMoq] = useState(supplier.moq_qty != null ? String(supplier.moq_qty) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({lead_time_days: Number(lt) || 7, order_cycle_days: Number(oc) || 7, moq_qty: moq ? Number(moq) : null});
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', background: '#0f172a', borderRadius: 10, padding: '12px 16px'}}>
      <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
        <span style={{fontSize: '0.78em', color: '#94a3b8'}}>Срок доставки (дней)</span>
        <input type="number" min={1} max={365} value={lt} onChange={e => setLt(e.target.value)}
          style={{width: 80, padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: '1em'}} />
      </label>
      <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
        <span style={{fontSize: '0.78em', color: '#94a3b8'}}>Цикл заказа (дней)</span>
        <input type="number" min={1} max={365} value={oc} onChange={e => setOc(e.target.value)}
          style={{width: 80, padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: '1em'}} />
      </label>
      <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
        <span style={{fontSize: '0.78em', color: '#94a3b8'}}>МЗП (шт)</span>
        <input type="number" min={0} value={moq} onChange={e => setMoq(e.target.value)} placeholder="—"
          style={{width: 80, padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: '1em'}} />
      </label>
      <button onClick={save} disabled={saving}
        style={{padding: '8px 18px', borderRadius: 6, background: saved ? '#22c55e' : '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, minWidth: 100}}>
        {saving ? '…' : saved ? '✓ Сохранено' : 'Сохранить'}
      </button>
      <div style={{fontSize: '0.78em', color: '#64748b', alignSelf: 'center'}}>
        ⚠ После изменения пересчитайте рекомендации
      </div>
    </div>
  );
}

// ── Analytics page (unified) ─────────────────────────────────────────────────

const MONTH_NAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

// ─ Donut: 4-segment inventory structure ──────────────────────────────────────
function AnalyticsDonut({summary, drillKey, onDrill}: {
  summary: AnalyticsSummary; drillKey: string|null; onDrill: (k: string|null) => void;
}) {
  const [hov, setHov] = useState<string|null>(null);
  const segs = [
    {key:'normal',         label:'Норм',             color:'#22c55e', ...summary.segments.normal},
    {key:'overstock_only', label:'Только перестой',  color:'#f97316', ...summary.segments.overstock_only},
    {key:'nlq_only',       label:'Только неликвид',  color:'#eab308', ...summary.segments.nlq_only},
    {key:'both',           label:'Перестой+неликвид',color:'#ef4444', ...summary.segments.both},
  ];
  const total = segs.reduce((s, x) => s + x.count, 0);
  if (total === 0) return <div style={{color:'#64748b',padding:32}}>Нет данных</div>;
  const R=88, r=50, cx=100, cy=100;
  let cumA = -Math.PI / 2;
  const arcs = segs.map(seg => {
    const frac = seg.count / total;
    const sweep = frac * 2 * Math.PI;
    const sa = cumA, ea = cumA + sweep;
    cumA += sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const d = [`M ${cx+R*Math.cos(sa)} ${cy+R*Math.sin(sa)}`,
               `A ${R} ${R} 0 ${large} 1 ${cx+R*Math.cos(ea)} ${cy+R*Math.sin(ea)}`,
               `L ${cx+r*Math.cos(ea)} ${cy+r*Math.sin(ea)}`,
               `A ${r} ${r} 0 ${large} 0 ${cx+r*Math.cos(sa)} ${cy+r*Math.sin(sa)}`,'Z'].join(' ');
    return {...seg, d, frac};
  });
  return (
    <div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
      <svg width={200} height={200} style={{flexShrink:0}}>
        {arcs.map(a => (
          <path key={a.key} d={a.d} fill={a.color}
            opacity={hov && hov!==a.key ? 0.3 : drillKey===a.key ? 1 : hov===a.key ? 1 : 0.82}
            stroke={drillKey===a.key ? '#fff' : 'none'} strokeWidth={2}
            style={{cursor:'pointer',transition:'opacity .12s'}}
            onClick={() => onDrill(drillKey===a.key ? null : a.key)}
            onMouseEnter={() => setHov(a.key)} onMouseLeave={() => setHov(null)}/>
        ))}
        <text x={cx} y={cy-6} textAnchor="middle" fill="#f1f5f9" fontSize={26} fontWeight={700}>{total.toLocaleString('ru-RU')}</text>
        <text x={cx} y={cx+10} textAnchor="middle" fill="#64748b" fontSize={11}>с остатком</text>
      </svg>
      <div style={{display:'flex',flexDirection:'column',gap:7}}>
        {arcs.map(a => (
          <div key={a.key} style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',
              opacity:hov && hov!==a.key ? 0.4 : 1}}
            onClick={() => onDrill(drillKey===a.key ? null : a.key)}
            onMouseEnter={() => setHov(a.key)} onMouseLeave={() => setHov(null)}>
            <div style={{width:12,height:12,borderRadius:3,background:a.color,flexShrink:0,marginTop:3,
              outline:drillKey===a.key ? '2px solid #fff' : 'none'}}/>
            <div>
              <div style={{color:'#e2e8f0',fontSize:'0.82em',fontWeight:drillKey===a.key?700:400}}>{a.label}</div>
              <div style={{color:'#64748b',fontSize:'0.72em'}}>
                {a.count.toLocaleString('ru-RU')} шт · {Math.round(a.frac*100)}% · {(a.value/1000000).toFixed(1)} М₽
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─ Sales chart: 2024/2025/2026 grouped bars ───────────────────────────────────
function SalesYearChart({data}: {data: AnalyticsSaleRow[]}) {
  const [metric, setMetric] = useState<'qty'|'revenue'>('qty');
  const years = [2024,2025,2026];
  const yColors = ['#3b82f6','#22c55e','#f59e0b'];
  const byYM = new Map<string,number>();
  for (const r of data) byYM.set(`${r.year}-${r.month}`, metric==='qty' ? r.net_qty : r.revenue);
  const allVals = years.flatMap(y => Array.from({length:12},(_,i) => byYM.get(`${y}-${i+1}`) || 0));
  const maxV = Math.max(...allVals, 1);
  const W=580, H=180, PL=46, PR=6, PT=8, PB=22;
  const cW=W-PL-PR, cH=H-PT-PB, mW=cW/12, bW=Math.max(2,(mW-4)/3);
  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
        {(['qty','revenue'] as const).map(m => (
          <button key={m} className="ghost-btn" style={{padding:'2px 8px',fontSize:'0.75em',
            background:metric===m?'#1e3a5f':undefined}} onClick={() => setMetric(m)}>
            {m==='qty'?'Кол-во':'Выручка'}
          </button>
        ))}
        {years.map((y,i) => (
          <span key={y} style={{display:'flex',alignItems:'center',gap:4,fontSize:'0.75em',color:'#94a3b8'}}>
            <span style={{display:'inline-block',width:10,height:10,background:yColors[i],borderRadius:2}}/>
            {y}
          </span>
        ))}
      </div>
      <svg width={W} height={H} style={{overflow:'visible'}}>
        {[0,0.25,0.5,0.75,1].map(t => {
          const y = PT+cH*(1-t);
          const lbl = metric==='revenue' ? `${(maxV*t/1000000).toFixed(1)}М` : Math.round(maxV*t).toLocaleString('ru-RU');
          return <g key={t}>
            <line x1={PL} x2={PL+cW} y1={y} y2={y} stroke="#1e293b" strokeWidth={1}/>
            <text x={PL-4} y={y+4} textAnchor="end" fill="#475569" fontSize={9}>{lbl}</text>
          </g>;
        })}
        {Array.from({length:12},(_,mi) => years.map((yr,yi) => {
          const v = byYM.get(`${yr}-${mi+1}`) || 0;
          const bH = Math.max(1,(v/maxV)*cH);
          return <rect key={`${yr}-${mi}`} x={PL+mi*mW+yi*bW+2} y={PT+cH-bH}
            width={Math.max(1,bW-1)} height={bH} fill={yColors[yi]} opacity={0.8} rx={1}/>;
        }))}
        {Array.from({length:12},(_,mi) => (
          <text key={mi} x={PL+mi*mW+mW/2} y={H-5} textAnchor="middle" fill="#475569" fontSize={9}>
            {MONTH_NAMES_SHORT[mi]}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─ Supplier table ─────────────────────────────────────────────────────────────
type SupplierSortKey = 'nlq'|'overstock'|'score'|'value';
function SupplierTable({suppliers, sortKey, onSortChange, onDrill}: {
  suppliers: AnalyticsSupplier[]; sortKey: SupplierSortKey;
  onSortChange: (k: SupplierSortKey) => void; onDrill: (name: string) => void;
}) {
  const sorted = [...suppliers].sort((a,b) =>
    sortKey==='nlq' ? b.nlq_count-a.nlq_count :
    sortKey==='overstock' ? b.overstock_count-a.overstock_count :
    sortKey==='value' ? b.total_value-a.total_value :
    b.score-a.score
  );
  const Btn = ({k,label}: {k: SupplierSortKey; label: string}) => (
    <button className="ghost-btn" style={{padding:'2px 7px',fontSize:'0.72em',
      background:sortKey===k?'#1e3a5f':undefined,fontWeight:sortKey===k?700:400}}
      onClick={() => onSortChange(k)}>{label}</button>
  );
  const scoreColor = (s: number) => s>=70?'#22c55e':s>=50?'#f59e0b':'#ef4444';
  return (
    <div>
      <div style={{display:'flex',gap:6,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
        <span style={{color:'#64748b',fontSize:'0.75em'}}>Сортировать:</span>
        <Btn k="nlq" label="Неликвид↓"/><Btn k="overstock" label="Перестой↓"/>
        <Btn k="score" label="Рейтинг↓"/><Btn k="value" label="Сумма↓"/>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8em'}}>
          <thead>
            <tr style={{background:'#0a1628'}}>
              {[
                {label:'Поставщик',right:false},
                {label:'С ост.',right:true},{label:'Неликвид',right:true},
                {label:'%, М₽',right:true},{label:'Перестой',right:true},
                {label:'%, М₽',right:true},{label:'Рейтинг',right:true},
              ].map(h => <th key={h.label} style={{padding:'5px 8px',textAlign:h.right?'right':'left',color:'#64748b',fontWeight:500}}>{h.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0,60).map((s,i) => (
              <tr key={s.supplier_name}
                style={{borderBottom:'1px solid #1e293b',background:i%2===0?'rgba(255,255,255,.015)':undefined,cursor:'pointer'}}
                onClick={() => onDrill(s.supplier_name)}
                onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,.05)')}
                onMouseLeave={e=>(e.currentTarget.style.background=i%2===0?'rgba(255,255,255,.015)':'')}>
                <td style={{padding:'5px 8px',color:'#cbd5e1',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.supplier_name}</td>
                <td style={{padding:'5px 8px',textAlign:'right',color:'#475569'}}>{s.items_with_stock}</td>
                <td style={{padding:'5px 8px',textAlign:'right',color:s.nlq_count>0?'#fbbf24':'#334155',fontWeight:s.nlq_count>0?600:400}}>{s.nlq_count}</td>
                <td style={{padding:'5px 8px',textAlign:'right',color:'#64748b',fontSize:'0.88em'}}>{s.nlq_pct}% · {(s.nlq_value/1e6).toFixed(2)}М</td>
                <td style={{padding:'5px 8px',textAlign:'right',color:s.overstock_count>0?'#fb923c':'#334155',fontWeight:s.overstock_count>0?600:400}}>{s.overstock_count}</td>
                <td style={{padding:'5px 8px',textAlign:'right',color:'#64748b',fontSize:'0.88em'}}>{s.os_pct}% · {(s.overstock_value/1e6).toFixed(2)}М</td>
                <td style={{padding:'5px 8px',textAlign:'right'}}>
                  <span style={{display:'inline-block',padding:'1px 7px',borderRadius:4,background:scoreColor(s.score),color:'#fff',fontWeight:700,fontSize:'0.88em'}}>{s.score}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length>60 && <div style={{color:'#64748b',fontSize:'0.75em',marginTop:4}}>…ещё {sorted.length-60} поставщиков</div>}
    </div>
  );
}

// ─ Drill-down list with sorting ───────────────────────────────────────────────
type DrillSort = 'value'|'qty'|'coverage'|'days';
function AnalyticsDrillList({drillKey, items, total, loading, onClose, onNavigate, navigateLabel = '→ Каталог'}: {
  drillKey: string; items: AnalyticsDrillItem[]; total: number; loading: boolean;
  onClose: () => void; onNavigate?: (path: string) => void; navigateLabel?: string;
}) {
  const [sort, setSort] = useState<DrillSort>('value');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

  const sorted = useMemo(() => {
    return [...items].sort((a,b) => {
      let av: number, bv: number;
      if (sort==='value') { av=a.qty*(a.purchase_price||0); bv=b.qty*(b.purchase_price||0); }
      else if (sort==='qty') { av=a.qty; bv=b.qty; }
      else if (sort==='coverage') { av=a.coverage_days??99999; bv=b.coverage_days??99999; }
      else { av=a.days_since_last_sale??99999; bv=b.days_since_last_sale??99999; }
      return sortDir==='desc' ? bv-av : av-bv;
    });
  }, [items, sort, sortDir]);

  const segLabel: Record<string,string> = {
    overstock_only:'Только перестой', nlq_only:'Только неликвид',
    both:'Перестой и неликвид', normal:'Норм', pre_season:'Предсезон',
    all_nlq:'Неликвид поставщика', all_overstock:'Перестой поставщика',
  };
  const label = drillKey.startsWith('supplier:') ? `Поставщик: ${drillKey.slice(9)}` : (segLabel[drillKey]||drillKey);

  const SortBtn = ({k,label:l}: {k:DrillSort; label:string}) => (
    <button className="ghost-btn" style={{padding:'2px 7px',fontSize:'0.72em',
      background:sort===k?'#1e3a5f':undefined,fontWeight:sort===k?700:400}}
      onClick={() => { if(sort===k) setSortDir(d=>d==='asc'?'desc':'asc'); else {setSort(k);setSortDir('desc');} }}>
      {l}{sort===k?(sortDir==='desc'?' ↓':' ↑'):''}
    </button>
  );

  return (
    <div style={{marginTop:14,background:'#0f1e33',borderRadius:8,border:'1px solid #1e3a5f',overflow:'hidden'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 14px',background:'#0a1628',borderBottom:'1px solid #1e293b',flexWrap:'wrap',gap:8}}>
        <span style={{color:'#e2e8f0',fontWeight:600,fontSize:'0.88em'}}>{label} — {total.toLocaleString('ru-RU')} позиций</span>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{color:'#64748b',fontSize:'0.72em'}}>Сорт.:</span>
          <SortBtn k="value" label="Сумма₽"/><SortBtn k="qty" label="Ост."/>
          <SortBtn k="coverage" label="Покр."/><SortBtn k="days" label="Дней"/>
          <button className="ghost-btn" style={{padding:'2px 8px',fontSize:'0.75em',marginLeft:8}} onClick={onClose}>✕</button>
        </div>
      </div>
      {loading && <div style={{padding:20,color:'#64748b',textAlign:'center',fontSize:'0.85em'}}>Загрузка…</div>}
      {!loading && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.79em'}}>
            <thead>
              <tr style={{background:'#0a1628'}}>
                <th style={{padding:'5px 10px',textAlign:'left',color:'#64748b',fontWeight:500}}>Название</th>
                <th style={{padding:'5px 7px',textAlign:'right',color:'#64748b',fontWeight:500}}>Ост.</th>
                <th style={{padding:'5px 7px',textAlign:'right',color:'#64748b',fontWeight:500}}>Покр.дн.</th>
                <th style={{padding:'5px 7px',textAlign:'right',color:'#64748b',fontWeight:500}}>Без продаж</th>
                <th style={{padding:'5px 7px',textAlign:'right',color:'#64748b',fontWeight:500}}>Сумма ₽</th>
                <th style={{padding:'5px 7px',textAlign:'left',color:'#64748b',fontWeight:500}}>Группа</th>
                <th style={{padding:'5px 7px',textAlign:'left',color:'#64748b',fontWeight:500}}>Кл.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item,i) => {
                const val = item.qty*(item.purchase_price||0);
                const covColor = item.coverage_days!==null ? (item.coverage_days>90?'#f97316':item.coverage_days>56?'#fbbf24':'#94a3b8') : '#64748b';
                const dColor = item.days_since_last_sale!==null ? (item.days_since_last_sale>365?'#ef4444':item.days_since_last_sale>120?'#fbbf24':'#64748b') : '#ef4444';
                return (
                  <tr key={item.id} style={{borderBottom:'1px solid #1e293b',background:i%2===0?'rgba(255,255,255,.01)':undefined}}>
                    <td style={{padding:'5px 10px',color:'#cbd5e1',maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                      title={item.item_name}>{item.item_name}</td>
                    <td style={{padding:'5px 7px',textAlign:'right',color:'#94a3b8'}}>{item.qty.toLocaleString('ru-RU')}</td>
                    <td style={{padding:'5px 7px',textAlign:'right',color:covColor,fontWeight:600}}>
                      {item.coverage_days!==null ? item.coverage_days.toLocaleString('ru-RU') : '∞'}
                    </td>
                    <td style={{padding:'5px 7px',textAlign:'right',color:dColor}}>
                      {item.days_since_last_sale!==null ? `${item.days_since_last_sale}д` : 'никогда'}
                    </td>
                    <td style={{padding:'5px 7px',textAlign:'right',color:'#64748b'}}>
                      {val>0 ? Math.round(val).toLocaleString('ru-RU') : '—'}
                    </td>
                    <td style={{padding:'5px 7px',color:'#475569',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {item.group_l0||item.group_full_path||'—'}
                    </td>
                    <td style={{padding:'5px 7px'}}>
                      {(item.abc_class||item.xyz_class) ? <ClassBadge abc={item.abc_class||''} xyz={item.xyz_class||''}/> : <span style={{color:'#334155'}}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {!items.length && !loading && (
                <tr><td colSpan={7} style={{padding:'20px',textAlign:'center',color:'#475569'}}>Нет позиций</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !!onNavigate && items.length > 0 && (
        <div style={{padding:'8px 12px', background:'#0a1628', borderTop:'1px solid #1e293b'}}>
          <button className="ghost-btn" style={{padding:'4px 10px', fontSize:'0.78em'}} onClick={() => onNavigate(items[0].group_full_path || items[0].group_l0 || '')}>
            {navigateLabel}
          </button>
        </div>
      )}
      {total > items.length && !loading && (
        <div style={{padding:'5px 12px',color:'#64748b',fontSize:'0.75em',background:'#0a1628'}}>
          Показано {items.length} из {total.toLocaleString('ru-RU')} · сортировка применена к первым {items.length}
        </div>
      )}
    </div>
  );
}

// ─ Segment breakdown table (from /api/catalog2/analytics) ────────────────────
function BreakdownTable({segments, loading, onNavigate, onOpenCatalog}: {
  segments: C2AnalyticsSegment[]; loading?: boolean; onNavigate: (segment: C2AnalyticsSegment) => void; onOpenCatalog: (path: string) => void;
}) {
  if (!segments.length) return null;
  const statusColor = (s: string) => s==='healthy'?'#22c55e':s==='deficit'?'#ef4444':'#f59e0b';
  const statusLabel = (s: string) => s==='healthy'?'Норм':s==='deficit'?'Дефицит':s==='overstock'?'Перестой':'Мёртвый';
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8em'}}>
        <thead>
          <tr style={{background:'#0a1628'}}>
            {['Сегмент','SKU','Продажи 30д','Покрытие дн.','Dead SKU','Статус'].map(h => (
              <th key={h} style={{padding:'5px 8px',textAlign:h==='SKU'||h==='Продажи 30д'||h==='Покрытие дн.'||h==='Dead SKU'?'right':'left',color:'#64748b',fontWeight:500}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={7} style={{padding:'14px 10px', color:'#94a3b8'}}>
                <span className="spinner" style={{display:'inline-block', width:14, height:14, marginRight:8, verticalAlign:'-2px'}} />
                Загружаю сегмент…
              </td>
            </tr>
          )}
          {segments.map((seg,i) => (
            <tr key={seg.path} style={{borderBottom:'1px solid #1e293b',background:i%2===0?'rgba(255,255,255,.015)':undefined,cursor:'pointer'}}
              onClick={() => onNavigate(seg)}
              onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,.04)')}
              onMouseLeave={e=>(e.currentTarget.style.background=i%2===0?'rgba(255,255,255,.015)':'')}>
              <td style={{padding:'5px 8px',color:'#e2e8f0',fontWeight:500,maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'space-between'}}>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{seg.name}</span>
                  <button className="ghost-btn" style={{padding:'2px 7px',fontSize:'0.72em',flexShrink:0}}
                    onClick={e=>{e.stopPropagation();onOpenCatalog(seg.path);}}>→ Каталог</button>
                </div>
              </td>
              <td style={{padding:'5px 8px',textAlign:'right',color:'#64748b'}}>{num(seg.sku_count, '0')}</td>
              <td style={{padding:'5px 8px',textAlign:'right',color:'#22c55e'}}>{num(Math.round(seg.sales_qty_30 || 0), '0')}</td>
              <td style={{padding:'5px 8px',textAlign:'right',color:seg.coverage_days!==null&&seg.coverage_days<21?'#ef4444':seg.coverage_days!==null&&seg.coverage_days>180?'#f59e0b':'#94a3b8'}}>
                {seg.coverage_days!==null?`${seg.coverage_days} дн.`:'—'}
              </td>
              <td style={{padding:'5px 8px',textAlign:'right',color:seg.dead_stock_sku>0?'#f87171':'#334155'}}>{seg.dead_stock_sku}</td>
              <td style={{padding:'5px 8px'}}>
                <span style={{padding:'2px 7px',borderRadius:4,background:statusColor(seg.healthy_status)+'22',color:statusColor(seg.healthy_status),fontWeight:600,fontSize:'0.88em'}}>
                  {statusLabel(seg.healthy_status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─ Main AnalyticsPage component ───────────────────────────────────────────────
function AnalyticsPage({onOpenCatalog, initialPath = ''}: {onOpenCatalog?: (path: string, analyticsPath?: string) => void; initialPath?: string}) {
  // tree state
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeCache, setTreeCache] = useState<Map<string,{children:{name:string;item_count:number}[];directItems:number}>>(new Map());
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = useState('');
  const [treeSearchRes, setTreeSearchRes] = useState<C2GroupResult[]>([]);
  // path / data
  const [path, setPath] = useState(initialPath);
  const [summary, setSummary] = useState<AnalyticsSummary|null>(null);
  const [salesData, setSalesData] = useState<AnalyticsSaleRow[]>([]);
  const [suppliers, setSuppliers] = useState<AnalyticsSupplier[]>([]);
  const [breakdown, setBreakdown] = useState<C2AnalyticsSummary|null>(null);
  const [loading, setLoading] = useState(false);
  const [segmentLoadingPath, setSegmentLoadingPath] = useState<string|null>(null);
  const [leafItems, setLeafItems] = useState<AnalyticsDrillItem[]>([]);
  const [leafItemsLoading, setLeafItemsLoading] = useState(false);
  // drill-down
  const [drillKey, setDrillKey] = useState<string|null>(null);
  const [drillItems, setDrillItems] = useState<AnalyticsDrillItem[]>([]);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillLoading, setDrillLoading] = useState(false);
  // supplier sort
  const [supplierSort, setSupplierSort] = useState<SupplierSortKey>('nlq');

  useEffect(() => {
    if (initialPath) setPath(initialPath);
  }, [initialPath]);

  // ── tree loading ──────────────────────────────────────────────────────────
  const loadTreeChildren = useCallback(async (p: string) => {
    try {
      const qs = p ? `?path=${encodeURIComponent(p)}` : '';
      const data = await fetch(apiUrl(`/api/catalog2/children${qs}`)).then(r=>r.json());
      setTreeCache(prev => new Map(prev).set(p, {children: data.children||[], directItems: data.direct_items||0}));
    } catch {}
  }, []);

  const toggleTree = useCallback(async (p: string) => {
    setTreeExpanded(prev => {
      const next = new Set(prev);
      if (next.has(p)) { next.delete(p); return next; }
      next.add(p);
      return next;
    });
    if (!treeCache.has(p)) await loadTreeChildren(p);
  }, [treeCache, loadTreeChildren]);

  const treeNodes = useMemo(() => {
    type VN = {path:string;name:string;depth:number;hasChildren:boolean;isExpanded:boolean;itemCount:number};
    const result: VN[] = [];
    function walk(parentPath: string, depth: number) {
      const entry = treeCache.get(parentPath);
      if (!entry) return;
      for (const node of entry.children) {
        const np = parentPath ? `${parentPath} / ${node.name}` : node.name;
        const isExpanded = treeExpanded.has(np);
        const childEntry = treeCache.get(np);
        const hasChildren = !childEntry || childEntry.children.length > 0;
        result.push({path:np, name:node.name, depth, hasChildren, isExpanded, itemCount:node.item_count});
        if (isExpanded) walk(np, depth+1);
      }
    }
    walk('', 0);
    return result;
  }, [treeCache, treeExpanded]);

  useEffect(() => {
    loadTreeChildren('');
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (treeSearch.length < 2) { setTreeSearchRes([]); return; }
      try {
        const data = await fetch(apiUrl(`/api/catalog2/search-groups?q=${encodeURIComponent(treeSearch)}`)).then(r=>r.json());
        setTreeSearchRes(Array.isArray(data) ? data : []);
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [treeSearch]);

  // ── data loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setDrillKey(null);
    setDrillItems([]);
    const p = path ? `?path=${encodeURIComponent(path)}` : '';
    const scope = path.split(' / ').length > 1 ? 'subgroup' : 'group';
    Promise.all([
      fetch(apiUrl(`/api/analytics/summary${p}`)).then(r=>r.json()),
      fetch(apiUrl(`/api/analytics/sales-by-year${p}`)).then(r=>r.json()),
      fetch(apiUrl(`/api/analytics/suppliers${p}`)).then(r=>r.json()),
      fetch(apiUrl(`/api/catalog2/analytics?scope=${scope}${p ? '&path='+encodeURIComponent(path) : ''}`)).then(r=>r.json()),
    ]).then(([sum,sales,sups,bd]) => {
      setSummary(sum);
      setSalesData(Array.isArray(sales) ? sales : []);
      setSuppliers(Array.isArray(sups) ? sups : []);
      setBreakdown(bd && bd.segments ? bd : null);
    }).catch(console.error)
    .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    const segs = breakdown?.segments || [];
    const isLeaf = !!path && (!segs.length || (segs.length === 1 && segs[0].path.replace(/\s+/g, ' ').trim() === path.replace(/\s+/g, ' ').trim()));
    if (!isLeaf) {
      setLeafItems([]);
      setLeafItemsLoading(false);
      setSegmentLoadingPath(null);
      return;
    }
    let cancelled = false;
    setLeafItemsLoading(true);
    const params = new URLSearchParams({limit: '100', path, sort_by: 'qty', sort_dir: 'desc'});
    fetch(apiUrl(`/api/catalog2/items?${params}`))
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const mapped = Array.isArray(d.items) ? d.items.map((item: any) => ({
          id: item.id,
          item_code: item.item_code ?? null,
          item_name: item.item_name,
          barcode: item.barcode ?? null,
          qty: item.qty ?? 0,
          purchase_price: item.purchase_price ?? 0,
          retail_price: item.retail_price ?? 0,
          parent_name: item.parent_name ?? null,
          group_l0: item.group_l0 ?? null,
          group_full_path: path,
          forecast_day_matrix: item.forecast_day_matrix ?? null,
          abc_class: item.abc_class ?? null,
          xyz_class: item.xyz_class ?? null,
          forecast_to_order: item.forecast_to_order ?? null,
          last_sale_date: item.last_sale_date ?? null,
          days_since_last_sale: item.days_since_last_sale ?? null,
          coverage_days: item.coverage_days ?? null,
        })) : [];
        setLeafItems(mapped);
      })
      .catch(() => { if (!cancelled) setLeafItems([]); })
      .finally(() => { if (!cancelled) { setLeafItemsLoading(false); setSegmentLoadingPath(null); } });
    return () => { cancelled = true; };
  }, [breakdown, path]);

  // ── drill-down ────────────────────────────────────────────────────────────
  const drill = useCallback(async (key: string) => {
    if (drillKey === key) { setDrillKey(null); setDrillItems([]); return; }
    setDrillKey(key);
    setDrillLoading(true);
    try {
      let segment = key;
      let sup = '';
      if (key.startsWith('supplier:')) { sup = key.slice(9); segment = 'all_nlq'; }
      const params = new URLSearchParams({segment, limit:'100'});
      if (path) params.set('path', path);
      if (sup) params.set('supplier', sup);
      const d = await fetch(apiUrl(`/api/analytics/items?${params}`)).then(r=>r.json());
      setDrillItems(d.items||[]);
      setDrillTotal(d.total||0);
    } catch {}
    finally { setDrillLoading(false); }
  }, [drillKey, path]);

  const navigatePath = useCallback(async (newPath: string) => {
    const normalizedNewPath = normalizeCatalogPath(newPath);
    const cachedPaths = new Set<string>();
    for (const [parent, entry] of treeCache.entries()) {
      if (parent) cachedPaths.add(parent);
      for (const child of entry.children) cachedPaths.add(parent ? `${parent} / ${child.name}` : child.name);
    }
    const resolvedPath = Array.from(cachedPaths).find(p => normalizeCatalogPath(p) === normalizedNewPath) || newPath;
    setSegmentLoadingPath(resolvedPath);
    setLeafItems([]);
    setLeafItemsLoading(false);
    setPath(resolvedPath);
    const parts = resolvedPath.split(' / ');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join(' / ');
      if (!treeExpanded.has(p)) await toggleTree(p);
    }
  }, [treeCache, treeExpanded, toggleTree]);

  // ── computed KPIs ─────────────────────────────────────────────────────────
  const ov = breakdown?.overview;
  const totalStock = summary ? (summary.total_stock_value/1e6).toFixed(1) : '—';

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>

      {/* ── Left tree panel ────────────────────────────────────────────── */}
      <div style={{
        width: treeOpen ? 240 : 0, flexShrink:0, display:'flex', flexDirection:'column',
        background:'#0a1628', borderRight: treeOpen ? '1px solid #1e293b' : 'none',
        overflow:'hidden', transition:'width .2s ease',
      }}>
        <div style={{padding:'10px 10px 8px',borderBottom:'1px solid #1e293b',flexShrink:0}}>
          <div style={{fontSize:'0.65em',color:'#334155',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:6}}>Группы товаров</div>
          <input
            style={{width:'100%',boxSizing:'border-box',background:'#0f172a',border:'1px solid #1e293b',borderRadius:6,color:'#f1f5f9',padding:'4px 8px',fontSize:'0.78em',outline:'none'}}
            placeholder="Поиск группы…" value={treeSearch}
            onChange={e => setTreeSearch(e.target.value)}
          />
        </div>
        <div style={{overflowY:'auto',flex:1,padding:'6px 4px'}}>
          {treeSearch.length >= 2 ? (
            treeSearchRes.length===0
              ? <div style={{padding:'16px 8px',color:'#334155',fontSize:'0.78em',textAlign:'center'}}>Не найдено</div>
              : treeSearchRes.map((r,idx) => (
                  <div key={idx} onClick={() => {setPath(r.path);setTreeSearch('');}}
                    style={{padding:'5px 8px',borderRadius:5,cursor:'pointer',marginBottom:1,
                      background:path===r.path?'#1d4ed8':'transparent',fontSize:'0.75em'}}>
                    <div style={{color:path===r.path?'#fff':'#e2e8f0',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                      title={r.path}>{'·'.repeat(r.depth+1)} {r.name}</div>
                    <div style={{color:'#334155',fontSize:'0.85em'}}>{r.path} · {r.item_count.toLocaleString('ru-RU')}</div>
                  </div>
                ))
          ) : (
            <>
              <div onClick={() => setPath('')}
                style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                  padding:'5px 8px',borderRadius:5,cursor:'pointer',marginBottom:2,
                  background:path===''?'#1d4ed8':'transparent',fontSize:'0.8em',fontWeight:600}}>
                <span style={{color:path===''?'#fff':'#94a3b8'}}>Все товары</span>
              </div>
              {!treeCache.has('') && <div style={{padding:'12px 8px',color:'#334155',fontSize:'0.75em',textAlign:'center'}}>Загрузка…</div>}
              {treeNodes.map(node => (
                <div key={node.path} style={{paddingLeft:node.depth*14}}>
                  <div
                    style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                      padding:'4px 8px',borderRadius:5,cursor:'pointer',marginBottom:1,
                      background:path===node.path?'#1d4ed8':path.startsWith(node.path+' / ')?'rgba(29,78,216,.2)':'transparent',
                      fontSize:'0.78em'}}
                    onClick={() => setPath(node.path)}>
                    <div style={{display:'flex',alignItems:'center',gap:5,overflow:'hidden'}}>
                      {node.hasChildren && (
                        <span style={{color:'#60a5fa',fontSize:'0.9em',flexShrink:0,cursor:'pointer',padding:'0 2px'}}
                          onClick={e=>{e.stopPropagation();toggleTree(node.path);}}>
                          {node.isExpanded?'▾':'▸'}
                        </span>
                      )}
                      {!node.hasChildren && <span style={{width:14,flexShrink:0}}/>}
                      <span style={{color:path===node.path?'#fff':path.startsWith(node.path)?'#93c5fd':'#94a3b8',
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={node.name}>
                        {node.name}
                      </span>
                    </div>
                    <span style={{color:'#334155',fontSize:'0.78em',flexShrink:0}}>{node.itemCount.toLocaleString('ru-RU')}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Right content ──────────────────────────────────────────────── */}
      <div style={{flex:1,overflowY:'auto',padding:'14px 18px', position:'relative'}}>
        {loading && (
          <div style={{position:'sticky', top:0, zIndex:20, display:'flex', justifyContent:'center', pointerEvents:'none'}}>
            <div style={{display:'inline-flex', alignItems:'center', gap:8, background:'rgba(15,23,42,.92)', border:'1px solid #334155', borderRadius:999, padding:'8px 14px', color:'#cbd5e1', fontSize:'0.82em', marginBottom:10}}>
              <span className="spinner" style={{width:14, height:14}} />
              Обновляю аналитику…
            </div>
          </div>
        )}

        {/* breadcrumb + collapse toggle */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          <button className="ghost-btn" style={{padding:'2px 8px',fontSize:'0.75em'}}
            onClick={() => setTreeOpen(v=>!v)} title="Свернуть/развернуть дерево">
            {treeOpen ? '◂ Дерево' : '▸ Дерево'}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:4,fontSize:'0.8em',color:'#475569',flexWrap:'wrap'}}>
            <span style={{cursor:'pointer',color:'#60a5fa'}} onClick={() => setPath('')}>Все товары</span>
            {path.split(' / ').filter(Boolean).map((part,i,arr) => {
              const subPath = arr.slice(0,i+1).join(' / ');
              return (
                <span key={i} style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{color:'#334155'}}>/</span>
                  <span style={{cursor:'pointer',color:i===arr.length-1?'#e2e8f0':'#60a5fa'}}
                    onClick={() => setPath(subPath)}>{part}</span>
                </span>
              );
            })}
          </div>
          {loading && <span style={{color:'#64748b',fontSize:'0.75em'}}>Загрузка…</span>}
        </div>

        {/* KPI cards: top row with 6 cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:14}}>
          {ov && <>
            <div style={{background:'#0a1628',borderRadius:8,padding:'10px 14px',border:'1px solid #1e293b'}}>
              <div style={{color:'#64748b',fontSize:'0.68em',marginBottom:3}}>SKU всего</div>
              <div style={{color:'#f1f5f9',fontSize:'1.4em',fontWeight:700,lineHeight:1}}>{num(ov.total_sku)}</div>
              <div style={{color:'#475569',fontSize:'0.68em',marginTop:2}}>активных {num(ov.active_sku)}</div>
            </div>
            <div style={{background:'#0a1628',borderRadius:8,padding:'10px 14px',border:'1px solid #1e293b'}}>
              <div style={{color:'#64748b',fontSize:'0.68em',marginBottom:3}}>Сток (закуп.)</div>
              <div style={{color:'#60a5fa',fontSize:'1.4em',fontWeight:700,lineHeight:1}}>{(ov.stock_value_purchase/1e6).toFixed(1)} М₽</div>
              <div style={{color:'#475569',fontSize:'0.68em',marginTop:2}}>розн. {(ov.stock_value_retail/1e6).toFixed(1)} М₽</div>
            </div>
            <div style={{background:'#0a1628',borderRadius:8,padding:'10px 14px',border:'1px solid #1e293b'}}>
              <div style={{color:'#64748b',fontSize:'0.68em',marginBottom:3}}>Продажи 30д</div>
              <div style={{color:'#22c55e',fontSize:'1.4em',fontWeight:700,lineHeight:1}}>{num(Math.round(ov.total_sales_qty_30 || 0), '0')}</div>
              <div style={{color:'#475569',fontSize:'0.68em',marginTop:2}}>365д: {num(Math.round(ov.total_sales_qty_365 || 0), '0')}</div>
            </div>
            <div style={{background:'#0a1628',borderRadius:8,padding:'10px 14px',border:'1px solid #1e293b'}}>
              <div style={{color:'#64748b',fontSize:'0.68em',marginBottom:3}}>Покрытие</div>
              <div style={{color:ov.coverage_days!=null&&ov.coverage_days>180?'#f59e0b':'#f1f5f9',fontSize:'1.4em',fontWeight:700,lineHeight:1}}>{ov.coverage_days!=null?`${ov.coverage_days} дн.`:'—'}</div>
              <div style={{color:'#475569',fontSize:'0.68em',marginTop:2}}>dead {ov.dead_stock_share}%</div>
            </div>
          </>}
          {summary && <>
            <div style={{background:'#0a1628',borderRadius:8,padding:'10px 14px',border:`1px solid ${drillKey==='overstock_only'?'#f97316':'#1e293b'}`,cursor:'pointer'}}
              onClick={() => drill('overstock_only')}>
              <div style={{color:'#64748b',fontSize:'0.68em',marginBottom:3}}>Перестой</div>
              <div style={{color:'#f97316',fontSize:'1.4em',fontWeight:700,lineHeight:1}}>{num((summary.segments.overstock_only.count||0)+(summary.segments.both.count||0), '0')}</div>
              <div style={{color:'#475569',fontSize:'0.68em',marginTop:2}}>{((summary.segments.overstock_only.value+summary.segments.both.value)/1e6).toFixed(1)} М₽</div>
            </div>
            <div style={{background:'#0a1628',borderRadius:8,padding:'10px 14px',border:`1px solid ${drillKey==='nlq_only'?'#eab308':'#1e293b'}`,cursor:'pointer'}}
              onClick={() => drill('nlq_only')}>
              <div style={{color:'#64748b',fontSize:'0.68em',marginBottom:3}}>Неликвид</div>
              <div style={{color:'#eab308',fontSize:'1.4em',fontWeight:700,lineHeight:1}}>{num((summary.segments.nlq_only.count||0)+(summary.segments.both.count||0), '0')}</div>
              <div style={{color:'#475569',fontSize:'0.68em',marginTop:2}}>{((summary.segments.nlq_only.value+summary.segments.both.value)/1e6).toFixed(1)} М₽</div>
            </div>
          </>}
        </div>

        {/* Charts row: donut + sales */}
        {summary && (
          <div style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:14}}>
            <div style={{background:'#0a1628',borderRadius:8,padding:14,border:'1px solid #1e293b',flexShrink:0}}>
              <div style={{color:'#94a3b8',fontSize:'0.7em',marginBottom:10}}>Структура остатков</div>
              {loading ? (
                <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:200, color:'#64748b', fontSize:'0.82em'}}>
                  <span className="spinner" style={{width:16, height:16, marginRight:8}} /> Загрузка структуры…
                </div>
              ) : <AnalyticsDonut summary={summary} drillKey={drillKey} onDrill={drill}/>} 
              {summary.pre_season_count > 0 && (
                <div style={{marginTop:10,padding:'6px 10px',background:'rgba(167,139,250,.1)',borderRadius:6,border:'1px solid #7c3aed',cursor:'pointer',fontSize:'0.78em',color:'#a78bfa'}}
                  onClick={() => drill('pre_season')}>
                  ↑ Предсезон: {summary.pre_season_count.toLocaleString('ru-RU')} товаров к заказу
                </div>
              )}
            </div>
            <div style={{background:'#0a1628',borderRadius:8,padding:14,border:'1px solid #1e293b',flex:1,minWidth:300,overflow:'hidden'}}>
              <div style={{color:'#94a3b8',fontSize:'0.7em',marginBottom:4}}>Продажи по годам</div>
              {loading ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:180,color:'#64748b',fontSize:'0.82em'}}><span className="spinner" style={{width:16,height:16,marginRight:8}} /> Загрузка продаж…</div> : (salesData.length > 0 ? <SalesYearChart data={salesData}/> : <div style={{color:'#475569',padding:24,textAlign:'center',fontSize:'0.82em'}}>Нет данных</div>)}
            </div>
          </div>
        )}

        {/* Breakdown table: child segments */}
        {breakdown && breakdown.segments.length > 0 && (
          <div style={{background:'#0a1628',borderRadius:8,padding:14,border:'1px solid #1e293b',marginBottom:14}}>
            <div style={{color:'#94a3b8',fontSize:'0.7em',marginBottom:10}}>
              Дочерние сегменты — клик по строке углубляет контекст
            </div>
            <BreakdownTable
              segments={breakdown.segments}
              loading={!!segmentLoadingPath}
              onNavigate={async segment => {
                const currentEntry = treeCache.get(path);
                const matchedChild = currentEntry?.children?.find(ch => normalizeCatalogPath(ch.name) === normalizeCatalogPath(segment.name));
                if (matchedChild) {
                  navigatePath(path ? `${path} / ${matchedChild.name}` : matchedChild.name);
                  return;
                }
                try {
                  const candidates = await fetch(apiUrl(`/api/catalog2/search-groups?q=${encodeURIComponent(segment.name)}`)).then(r => r.json());
                  const targetNorm = normalizeCatalogPath(path);
                  const resolved = (Array.isArray(candidates) ? candidates : []).find((c: any) => {
                    const candNorm = normalizeCatalogPath(c.path || '');
                    return candNorm.startsWith(targetNorm) && normalizeCatalogPath(c.name || '') === normalizeCatalogPath(segment.name)
                      && (typeof c.item_count !== 'number' || c.item_count === segment.sku_count);
                  }) || (Array.isArray(candidates) ? candidates : []).find((c: any) => {
                    const candNorm = normalizeCatalogPath(c.path || '');
                    return candNorm.startsWith(targetNorm) && normalizeCatalogPath(c.name || '') === normalizeCatalogPath(segment.name);
                  });
                  navigatePath(resolved?.path || segment.path || (path ? `${path} / ${segment.name}` : segment.name));
                } catch {
                  navigatePath(segment.path || (path ? `${path} / ${segment.name}` : segment.name));
                }
              }}
              onOpenCatalog={p => onOpenCatalog?.(p, path)}
            />
          </div>
        )}

        {/* Supplier analytics */}
        <div style={{background:'#0a1628',borderRadius:8,padding:14,border:'1px solid #1e293b',marginBottom:14}}>
          <div style={{color:'#94a3b8',fontSize:'0.7em',marginBottom:4}}>Аналитика по поставщикам</div>
          <div style={{color:'#e2e8f0',fontWeight:600,fontSize:'0.88em',marginBottom:10}}>
            {suppliers.length} поставщиков · рейтинг: меньше неликвида/перестоя + больше A-товаров
          </div>
          {loading ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:120,color:'#64748b',fontSize:'0.82em'}}><span className="spinner" style={{width:16,height:16,marginRight:8}} /> Загрузка поставщиков…</div> : (suppliers.length > 0
            ? <SupplierTable suppliers={suppliers} sortKey={supplierSort} onSortChange={setSupplierSort}
                onDrill={name => drill(`supplier:${name}`)}/>
            : <div style={{color:'#475569',padding:'16px 0',textAlign:'center',fontSize:'0.82em'}}>Нет данных о поставщиках</div>)}
        </div>

        {/* Drill-down list */}
        {drillKey && (
          <AnalyticsDrillList
            drillKey={drillKey} items={drillItems} total={drillTotal} loading={drillLoading}
            onClose={() => { setDrillKey(null); setDrillItems([]); }}
            onNavigate={p => onOpenCatalog?.(p, path)}
          />
        )}

        {!!path && !drillKey && (leafItemsLoading || leafItems.length > 0) && (
          <AnalyticsDrillList
            drillKey={`segment:${path}`}
            items={leafItems}
            total={leafItems.length}
            loading={leafItemsLoading}
            onClose={() => { setLeafItems([]); setLeafItemsLoading(false); }}
            onNavigate={() => onOpenCatalog?.(path)}
            navigateLabel="→ Открыть сегмент в каталоге"
          />
        )}

        {/* Total stock value note */}
        <div style={{color:'#334155',fontSize:'0.72em',textAlign:'right',marginTop:8}}>
          Закупочная стоимость всего склада: {totalStock} М₽
        </div>
      </div>
    </div>
  );
}

// ── main app ──────────────────────────────────────────────────────────────────

export function App() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [orders, setOrders] = useState<OrderBatch[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [currentDraft, setCurrentDraft] = useState<DraftDetail | null>(null);
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);
  const [tab, setTab] = useState<TabKey>(getTabFromLocation());
  const [mode, setMode] = useState<CreateMode | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Recommendation[]>([]);
  const [searchSupplierFilter, setSearchSupplierFilter] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);

  // scroll ref for draft items section
  const draftItemsRef = useRef<HTMLElement>(null);

  // explain modal
  const [explainRow, setExplainRow] = useState<Recommendation | null>(null);

  // edit qty modal (pencil button opens this)
  const [editQtyState, setEditQtyState] = useState<{item: DraftItem} | null>(null);

  // recommendations table pagination
  const [recPage, setRecPage] = useState(0);
  const REC_PAGE_SIZE = 50;

  // order items pagination
  const [orderPage, setOrderPage] = useState(0);
  const ORDER_PAGE_SIZE = 50;

  // "Добавить" button feedback
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  // non-liquid state
  const [nonLiquidItems, setNonLiquidItems] = useState<NonLiquidItem[]>([]);
  const [nonLiquidGroups, setNonLiquidGroups] = useState<string[]>([]);
  const [nonLiquidGroup, setNonLiquidGroup] = useState('');
  const [nonLiquidSearch, setNonLiquidSearch] = useState('');
  const [nonLiquidTotal, setNonLiquidTotal] = useState(0);
  const [nonLiquidOffset, setNonLiquidOffset] = useState(0);
  const [nonLiquidLimit] = useState(100);
  const [nonLiquidHasMore, setNonLiquidHasMore] = useState(false);
  const [nonLiquidLoading, setNonLiquidLoading] = useState(false);

  const [loading, setLoading] = useState(false);

  // catalog state
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogGroup, setCatalogGroup] = useState('');
  const [catalogSupplier, setCatalogSupplier] = useState('');
  const [catalogSortBy, setCatalogSortBy] = useState('to_order');
  const [catalogSortDir, setCatalogSortDir] = useState<'asc'|'desc'>('desc');
  const [catalogGroups, setCatalogGroups] = useState<string[]>([]);
  const CATALOG_LIMIT = 100;

  // sidebar collapse
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // catalog2 tree panel collapse
  const [c2TreeOpen, setC2TreeOpen] = useState(true);

  // catalog2 (tree catalog from ping JSON)
  const [c2Items, setC2Items] = useState<Catalog2Item[]>([]);
  const [c2ForecastMap, setC2ForecastMap] = useState<Record<string, any>>({});
  const [c2Total, setC2Total] = useState(0);
  const [c2Offset, setC2Offset] = useState(0);
  const [c2HasMore, setC2HasMore] = useState(false);
  const [c2Loading, setC2Loading] = useState(false);
  const [c2Search, setC2Search] = useState('');
  const [c2Path, setC2Path] = useState('');
  const [analyticsReturnPath, setAnalyticsReturnPath] = useState('');
  const [c2Expanded, setC2Expanded] = useState<Set<string>>(new Set());
  const [c2TreeCache, setC2TreeCache] = useState<Map<string, C2TreeEntry>>(new Map());
  const [c2Modal, setC2Modal] = useState<Catalog2Item | null>(null);
  const [c2Sales, setC2Sales] = useState<C2SalesData | null>(null);
  const [c2SalesLoading, setC2SalesLoading] = useState(false);
  const [c2ChartFrom, setC2ChartFrom] = useState('2024-01');
  const [c2ChartTo, setC2ChartTo] = useState(() => new Date().toISOString().slice(0, 7));
  const [c2ChartGran, setC2ChartGran] = useState<C2Gran>('month');
  const [c2SortBy, setC2SortBy] = useState('qty');
  const [c2SortDir, setC2SortDir] = useState<'asc'|'desc'>('desc');
  const [c2HasStock, setC2HasStock] = useState(false);
  const [c2TreeSearch, setC2TreeSearch] = useState('');
  const [c2TreeSearchResults, setC2TreeSearchResults] = useState<C2GroupResult[]>([]);
  const [c2Forecast, setC2Forecast] = useState<C2Forecast | null>(null);
  const [c2ForecastLoading, setC2ForecastLoading] = useState(false);

  // ── api helpers ─────────────────────────────────────────────────────────────

  async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...options});
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function loadSuppliers() {
    const data = await fetchJSON<Supplier[]>(apiUrl('/api/suppliers'));
    setSuppliers(data);
    if (!selectedSupplier && data[0]) setSelectedSupplier(data[0].supplier_name);
  }
  async function loadOrders() { setOrders(await fetchJSON<OrderBatch[]>(apiUrl('/api/orders'))); }
  async function loadDrafts() { setDrafts(await fetchJSON<DraftSummary[]>(apiUrl('/api/drafts'))); }
  async function loadDashboard() { setDashboard(await fetchJSON<Dashboard>(apiUrl('/api/dashboard'))); }
  async function loadDecisions() { setDecisions(await fetchJSON<Decision[]>(apiUrl('/api/decisions'))); }

  async function loadCatalogGroups() {
    try { setCatalogGroups(await fetchJSON<string[]>(apiUrl('/api/products-catalog/groups'))); } catch {}
  }

  async function loadCatalog(group = catalogGroup, q = catalogSearch, supplier = catalogSupplier, sortBy = catalogSortBy, sortDir = catalogSortDir, offset = catalogOffset) {
    const params = new URLSearchParams();
    if (group) params.set('subgroup', group);
    if (q.trim()) params.set('q', q.trim());
    if (supplier) params.set('supplier', supplier);
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
    params.set('limit', String(CATALOG_LIMIT));
    params.set('offset', String(offset));
    setCatalogLoading(true);
    try {
      const data = await fetchJSON<CatalogResponse>(apiUrl(`/api/products-catalog?${params}`));
      setCatalogItems(Array.isArray(data?.items) ? data.items : []);
      setCatalogTotal(Number(data?.total || 0));
      setCatalogOffset(Number(data?.offset || 0));
      setCatalogHasMore(Boolean(data?.has_more));
    } catch (err) {
      console.error('loadCatalog failed', err);
      setCatalogItems([]); setCatalogTotal(0); setCatalogHasMore(false);
    } finally { setCatalogLoading(false); }
  }

  async function c2LoadChildren(path: string) {
    try {
      const qs = path ? `?path=${encodeURIComponent(path)}` : '';
      const data = await fetchJSON<{children: C2TreeNode[]; direct_items: number}>(apiUrl(`/api/catalog2/children${qs}`));
      setC2TreeCache(prev => new Map(prev).set(path, {children: data.children, directItems: data.direct_items}));
    } catch (err) { console.error('c2LoadChildren', err); }
  }

  async function resolveCatalogPath(path: string, parentHint = '') {
    if (!path) return '';
    try {
      const candidates = await fetchJSON<C2GroupResult[]>(apiUrl(`/api/catalog2/search-groups?q=${encodeURIComponent(path.split(' / ').filter(Boolean).pop() || path)}`));
      const normalizedPath = normalizeCatalogPath(path);
      const normalizedParent = normalizeCatalogPath(parentHint);
      const exact = candidates.find(c => normalizeCatalogPath(c.path) === normalizedPath);
      if (exact) return exact.path;
      const scoped = candidates.find(c => normalizeCatalogPath(c.path).startsWith(normalizedParent) && normalizeCatalogPath(c.path).endsWith(normalizeCatalogPath(path).split(' / ').slice(-1)[0] || ''));
      if (scoped) return scoped.path;
    } catch {}
    return path;
  }

  async function c2LoadItems(path: string, q: string, offset: number, sortBy = c2SortBy, sortDir = c2SortDir, hasStock = c2HasStock) {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (q.trim()) params.set('q', q.trim());
    params.set('limit', '50');
    params.set('offset', String(offset));
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
    if (hasStock) params.set('has_stock', '1');
    setC2Loading(true);
    try {
      const data = await fetchJSON<Catalog2Response>(apiUrl(`/api/catalog2/items?${params}`));
      setC2Items(Array.isArray(data?.items) ? data.items : []);
      setC2Total(Number(data?.total ?? 0));
      setC2Offset(Number(data?.offset ?? 0));
      setC2HasMore(Boolean(data?.has_more));
    } catch (err) {
      console.error('c2LoadItems', err);
      setC2Items([]); setC2Total(0); setC2HasMore(false);
    } finally { setC2Loading(false); }
  }

  async function c2LoadForecast(code: string) {
    if (!code) return;
    setC2ForecastLoading(true);
    try {
      const data = await fetchJSON<C2Forecast>(apiUrl(`/api/catalog2/item/${encodeURIComponent(code)}/forecast`));
      setC2Forecast(data);
    } catch { setC2Forecast(null); }
    finally { setC2ForecastLoading(false); }
  }

  async function c2SearchGroups(q: string) {
    if (q.length < 2) { setC2TreeSearchResults([]); return; }
    try {
      const data = await fetchJSON<C2GroupResult[]>(apiUrl(`/api/catalog2/search-groups?q=${encodeURIComponent(q)}`));
      setC2TreeSearchResults(data);
    } catch { setC2TreeSearchResults([]); }
  }

  async function c2LoadSales(code: string, from: string, to: string, gran: C2Gran) {
    if (!code) return;
    setC2SalesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('from', from + '-01');
      params.set('to', to + '-31');
      params.set('gran', gran);
      const data = await fetchJSON<C2SalesData>(apiUrl(`/api/catalog2/item/${encodeURIComponent(code)}/sales?${params}`));
      setC2Sales(data);
    } catch { setC2Sales(null); }
    finally { setC2SalesLoading(false); }
  }


  async function c2ToggleExpand(path: string) {
    const isOpen = c2Expanded.has(path);
    const next = new Set(c2Expanded);
    if (isOpen) { next.delete(path); }
    else {
      next.add(path);
      if (!c2TreeCache.has(path)) await c2LoadChildren(path);
    }
    setC2Expanded(next);
  }

  async function loadNonLiquidGroups() {
    setNonLiquidLoading(true);
    try { setNonLiquidGroups(await fetchJSON<string[]>(apiUrl('/api/non-liquid/groups'))); }
    finally { setNonLiquidLoading(false); }
  }

  async function loadNonLiquidItems(group = nonLiquidGroup, q = nonLiquidSearch, offset = nonLiquidOffset) {
    const params = new URLSearchParams();
    if (group) params.set('subgroup', group);
    if (q.trim()) params.set('q', q.trim());
    params.set('limit', String(nonLiquidLimit));
    params.set('offset', String(offset));
    setNonLiquidLoading(true);
    try {
      const data = await fetchJSON<NonLiquidResponse>(apiUrl(`/api/non-liquid-paged?${params}`));
      setNonLiquidItems(Array.isArray(data?.items) ? data.items : []);
      setNonLiquidTotal(Number(data?.total || 0));
      setNonLiquidOffset(Number(data?.offset || 0));
      setNonLiquidHasMore(Boolean(data?.has_more));
    } catch (err) {
      console.error('loadNonLiquidItems failed', err);
      setNonLiquidItems([]);
      setNonLiquidTotal(0);
      setNonLiquidHasMore(false);
    } finally { setNonLiquidLoading(false); }
  }

  async function openDraft(id: number) {
    const detail = await fetchJSON<DraftDetail>(apiUrl(`/api/drafts/${id}`));
    setCurrentDraft(detail);
    setMode(detail.batch.draft_mode);
    setTab('create');
    navigateToTab('create');
  }

  async function openOrderDetail(id: number) {
    setOpenOrder(await fetchJSON<OrderDetail>(apiUrl(`/api/orders/${id}`)));
    setOrderPage(0);
  }

  // ── effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp; tg?.ready?.(); tg?.expand?.();
    const onHash = () => setTab(getTabFromLocation());
    window.addEventListener('hashchange', onHash);
    (async () => {
      try {
        await Promise.all([loadSuppliers(), loadOrders(), loadDrafts(), loadDashboard(), loadNonLiquidGroups(), loadCatalogGroups()]);
        await loadNonLiquidItems('', '', 0);
        if (getTabFromLocation() === 'create') {
          const latest = await fetchJSON<DraftSummary | null>(apiUrl('/api/drafts/latest'));
          if (latest) {
            const resume = window.confirm('Продолжить последнюю заявку? Нажмите Cancel для новой.');
            if (resume) await openDraft(latest.id);
          }
        }
      } catch (err) { console.error('bootstrap failed', err); }
    })();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!selectedSupplier || mode !== 'single') return;
    setLoading(true);
    setRecPage(0);
    setAddedIds(new Set());
    fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`))
      .then(setRecommendations)
      .finally(() => setLoading(false));
  }, [selectedSupplier, mode]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return void setSearchResults([]);
    const t = setTimeout(async () => {
      const rows = await fetchJSON<Recommendation[]>(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
      setSearchResults(searchSupplierFilter ? rows.filter(r => r.supplier_name === searchSupplierFilter) : rows);
    }, 250);
    return () => clearTimeout(t);
  }, [search, searchSupplierFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadNonLiquidItems(nonLiquidGroup, nonLiquidSearch, nonLiquidOffset).catch(console.error);
    }, 200);
    return () => clearTimeout(t);
  }, [nonLiquidGroup, nonLiquidSearch, nonLiquidOffset]);

  useEffect(() => {
    if (tab === 'decisions') loadDecisions();
    if (tab === 'catalog') loadCatalog(catalogGroup, catalogSearch, catalogSupplier, catalogSortBy, catalogSortDir, 0);
    if (tab === 'catalog2') {
      if (!c2TreeCache.has('')) c2LoadChildren('');
      c2LoadItems(c2Path, c2Search, 0);
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== 'catalog') return;
    const t = setTimeout(() => {
      setCatalogOffset(0);
      loadCatalog(catalogGroup, catalogSearch, catalogSupplier, catalogSortBy, catalogSortDir, 0);
    }, 300);
    return () => clearTimeout(t);
  }, [catalogSearch, catalogGroup, catalogSupplier, catalogSortBy, catalogSortDir]);

  useEffect(() => {
    if (tab !== 'catalog') return;
    loadCatalog(catalogGroup, catalogSearch, catalogSupplier, catalogSortBy, catalogSortDir, catalogOffset);
  }, [catalogOffset]);

  // catalog2 effects
  useEffect(() => {
    if (tab !== 'catalog2') return;
    const t = setTimeout(() => { setC2Offset(0); c2LoadItems(c2Path, c2Search, 0); }, 300);
    return () => clearTimeout(t);
  }, [c2Path, c2Search, c2SortBy, c2SortDir, c2HasStock]);


  useEffect(() => {
    const t = setTimeout(() => c2SearchGroups(c2TreeSearch), 250);
    return () => clearTimeout(t);
  }, [c2TreeSearch]);

  useEffect(() => {
    let cancelled = false;
    async function loadForecasts() {
      const missing = c2Items.slice(0, 50).filter(item => item.id && !(String(item.id) in c2ForecastMap));
      if (!missing.length) return;
      const results = await Promise.all(missing.map(async item => {
        const code = item.item_code?.trim() || String(item.id);
        try {
          const data = await fetchJSON<any>(apiUrl(`/api/catalog2/item/${encodeURIComponent(code)}/forecast`));
          return [String(item.id), data] as const;
        } catch {
          return [String(item.id), null] as const;
        }
      }));
      if (cancelled) return;
      setC2ForecastMap(prev => {
        const next = {...prev};
        for (const [id, data] of results) next[id] = data;
        return next;
      });
    }
    loadForecasts();
    return () => { cancelled = true; };
  }, [c2Items]);

  useEffect(() => {
    if (!c2Modal) { setC2Forecast(null); return; }
    const code = c2Modal.item_code?.trim() || String(c2Modal.id);
    c2LoadForecast(code);
  }, [c2Modal]);

  useEffect(() => {
    if (!c2Modal) return;
    const code = c2Modal.item_code?.trim() || String(c2Modal.id);
    c2LoadSales(code, c2ChartFrom, c2ChartTo, c2ChartGran);
  }, [c2Modal, c2ChartFrom, c2ChartTo, c2ChartGran]);

  // ── draft actions ─────────────────────────────────────────────────────────

  async function startDraft(nextMode: CreateMode) {
    const created = await fetchJSON<{id: number}>(apiUrl('/api/drafts'), {method: 'POST', body: JSON.stringify({draft_mode: nextMode})});
    await loadDrafts();
    await openDraft(created.id);
  }

  async function addRecommendationToDraft(row: Recommendation) {
    if (!currentDraft || addingId !== null) return;
    setAddingId(row.id);
    try {
      await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items`), {
        method: 'POST',
        body: JSON.stringify({item: {recommendation_id: row.id, manager_qty: row.to_order, reason: '', supplier_name: row.supplier_name}}),
      });
      setAddedIds(prev => new Set([...prev, row.id]));
      await openDraft(currentDraft.batch.id);
      setTimeout(() => draftItemsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}), 100);
    } catch (err) {
      console.error('addRecommendationToDraft failed', err);
    } finally {
      setAddingId(null);
    }
  }

  async function applyQtyChange(item: DraftItem, newQty: number, reason: string) {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items/${item.id}`), {
      method: 'POST',
      body: JSON.stringify({manager_qty: newQty, reason}),
    });
    await openDraft(currentDraft.batch.id);
    setEditQtyState(null);
  }

  async function removeDraftItem(itemId: number) {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items/${itemId}`), {method: 'DELETE'});
    await openDraft(currentDraft.batch.id);
    await loadDrafts();
  }

  async function submitDraft() {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/submit`), {method: 'POST'});
    setCurrentDraft(null);
    await loadDrafts();
    await loadOrders();
    setTab('orders');
    navigateToTab('orders');
  }

  async function saveSupplierSettings(name: string, patch: Partial<Supplier>) {
    await fetchJSON(apiUrl(`/api/suppliers/${encodeURIComponent(name)}/settings`), {method: 'PATCH', body: JSON.stringify(patch)});
    await loadSuppliers();
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const filteredCurrentItems = useMemo(() => {
    return (currentDraft?.items || []).filter(r => r.sku_name.toLowerCase().includes(listSearch.toLowerCase()));
  }, [currentDraft, listSearch]);

  const currentSupplier = suppliers.find(s => s.supplier_name === selectedSupplier);

  const filteredRecs = useMemo(() => {
    setRecPage(0);
    const q = listSearch.toLowerCase();
    return recommendations.filter(r => !q || r.sku_name.toLowerCase().includes(q));
  }, [recommendations, listSearch]);

  const recPagedItems = useMemo(() => filteredRecs.slice(recPage * REC_PAGE_SIZE, (recPage + 1) * REC_PAGE_SIZE), [filteredRecs, recPage]);
  const recTotalPages = Math.max(1, Math.ceil(filteredRecs.length / REC_PAGE_SIZE));

  const orderPagedItems = useMemo(() => {
    if (!openOrder) return [];
    return openOrder.items.slice(orderPage * ORDER_PAGE_SIZE, (orderPage + 1) * ORDER_PAGE_SIZE);
  }, [openOrder, orderPage]);

  // catalog2 tree: build flat visible list from expanded state + cache
  const c2VisibleNodes = useMemo(() => {
    type VN = {path: string; name: string; depth: number; hasChildren: boolean; isExpanded: boolean; itemCount: number};
    const result: VN[] = [];
    function walk(parentPath: string, depth: number) {
      const entry = c2TreeCache.get(parentPath);
      if (!entry) return;
      for (const node of entry.children) {
        const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
        const isExpanded = c2Expanded.has(path);
        const childEntry = c2TreeCache.get(path);
        const hasChildren = !childEntry || childEntry.children.length > 0;
        result.push({path, name: node.name, depth, hasChildren, isExpanded, itemCount: node.item_count});
        if (isExpanded) walk(path, depth + 1);
      }
    }
    walk('', 0);
    return result;
  }, [c2TreeCache, c2Expanded]);

  // ── render ────────────────────────────────────────────────────────────────

  const RAIL_W = 320;

  return (
    <div className="shell" style={{gridTemplateColumns: sidebarOpen ? `${RAIL_W}px 1fr` : '0px 1fr'}}>
      {/* sidebar toggle button */}
      <button
        className="sidebar-toggle"
        style={{left: sidebarOpen ? RAIL_W - 14 : 8}}
        onClick={() => setSidebarOpen(v => !v)}
        title={sidebarOpen ? 'Скрыть меню' : 'Показать меню'}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      {/* modals */}
      {c2Modal && (
        <ProductDetailModal2
          item={c2Modal}
          onClose={() => setC2Modal(null)}
          salesData={c2Sales}
          salesLoading={c2SalesLoading}
          chartFrom={c2ChartFrom}
          chartTo={c2ChartTo}
          chartGran={c2ChartGran}
          setChartFrom={setC2ChartFrom}
          setChartTo={setC2ChartTo}
          setChartGran={setC2ChartGran}
          forecastData={c2Forecast}
          forecastLoading={c2ForecastLoading}
        />
      )}
      {explainRow && <ExplainModal row={explainRow} onClose={() => setExplainRow(null)} />}
      {editQtyState && (
        <EditQtyModal
          item={editQtyState.item}
          onConfirm={(qty, reason) => applyQtyChange(editQtyState.item, qty, reason)}
          onCancel={() => setEditQtyState(null)}
        />
      )}

      <aside className={sidebarOpen ? 'rail' : 'rail rail-collapsed'}>
        <div className="brand">
          <h1>Закупки</h1>
          <span style={{fontSize: '0.7em', color: '#22c55e', fontWeight: 700, letterSpacing: '0.05em'}}>v2 · {new Date().toLocaleDateString('ru-RU')}</span>
          {dashboard && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8}}>
              {dashboard.urgent_count > 0 && <span style={{color: '#ef4444', fontSize: '0.8em'}}>🔴 Срочно: {dashboard.urgent_count} поз.</span>}
              {dashboard.pre_season_count > 0 && <span style={{color: '#f59e0b', fontSize: '0.8em'}}>⚡ Предсезон: {dashboard.pre_season_count} поз.</span>}
              {dashboard.overstock_count > 0 && <span style={{color: '#f97316', fontSize: '0.8em'}}>⚠ Перестой: {dashboard.overstock_count} поз.</span>}
            </div>
          )}
        </div>
        <div className="panel">
          <button className={tab === 'create' ? 'tab active' : 'tab'} onClick={() => { setTab('create'); navigateToTab('create'); if (!currentDraft) setMode(null); }}>Новая заявка</button>
          <button className={tab === 'drafts' ? 'tab active' : 'tab'} onClick={() => { setTab('drafts'); navigateToTab('drafts'); }}>Драфты</button>
          <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => { setTab('orders'); navigateToTab('orders'); }}>Заявки</button>
          <button className={tab === 'catalog' ? 'tab active' : 'tab'} onClick={() => { setTab('catalog'); navigateToTab('catalog'); }}>Товары</button>
          <button className={tab === 'catalog2' ? 'tab active' : 'tab'} onClick={() => { setTab('catalog2'); navigateToTab('catalog2'); }}>Каталог</button>
          <button className={tab === 'analytics' ? 'tab active' : 'tab'} onClick={() => { setTab('analytics'); navigateToTab('analytics'); }}>Аналитика склада</button>
          <button className={tab === 'nonLiquid' ? 'tab active' : 'tab'} onClick={() => { setTab('nonLiquid'); navigateToTab('nonLiquid'); }}>Неликвиды</button>
          <button className={tab === 'decisions' ? 'tab active' : 'tab'} onClick={() => { setTab('decisions'); navigateToTab('decisions'); }}>Решения менеджеров</button>
        </div>
      </aside>

      <main className="main">

        {/* ── CREATE TAB ─────────────────────────────────────────────────── */}
        {tab === 'create' && !currentDraft && (
          <section className="hero card">
            <div><span className="eyebrow">Новая заявка</span><h2>Какую заявку создать?</h2></div>
            <div className="step-cards">
              <button className="step-card" onClick={() => startDraft('single')}><strong>Один поставщик</strong><span>Все товары одного поставщика.</span></button>
              <button className="step-card" onClick={() => startDraft('multi')}><strong>Несколько поставщиков</strong><span>Поиск товаров по каталогу.</span></button>
            </div>
          </section>
        )}

        {tab === 'create' && currentDraft && (
          <>
            <section className="card search-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Составление заявки</span>
                  <h2>Заявка #{currentDraft.batch.id}</h2>
                  <div className="meta">Режим: {currentDraft.batch.draft_mode === 'single' ? 'один поставщик' : 'несколько поставщиков'}</div>
                </div>
              </div>

              {currentDraft.batch.draft_mode === 'single' ? (
                <>
                  <div className="inline-grid">
                    <label>
                      <span>Поставщик</span>
                      <select value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)}>
                        {suppliers.map(s => <option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Поиск по списку</span>
                      <input value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Название товара" />
                    </label>
                  </div>
                  {currentSupplier && (
                    <SupplierSettings
                      supplier={currentSupplier}
                      onSave={patch => saveSupplierSettings(currentSupplier.supplier_name, patch)}
                    />
                  )}
                </>
              ) : (
                <div className="inline-grid">
                  <label><span>Поиск по товарам</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Название товара" /></label>
                  <label>
                    <span>Фильтр по поставщику</span>
                    <select value={searchSupplierFilter} onChange={e => setSearchSupplierFilter(e.target.value)}>
                      <option value="">Все поставщики</option>
                      {suppliers.map(s => <option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </section>

            {/* recommendations table — single mode */}
            {currentDraft.batch.draft_mode === 'single' && (
              <section className="card table-card">
                {loading && <div className="loading-block"><div className="spinner" /><span>Загружаю…</span></div>}
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8}}>
                  <span className="meta">{filteredRecs.length} позиций к заказу</span>
                  <span style={{fontSize: '0.78em', color: '#64748b'}}>
                    <span style={{color: '#22c55e', fontWeight: 700}}>A</span>=топ 70%&nbsp;
                    <span style={{color: '#eab308', fontWeight: 700}}>B</span>=20%&nbsp;
                    <span style={{color: '#94a3b8', fontWeight: 700}}>C</span>=10%&nbsp;&nbsp;
                    <span style={{color: '#22c55e', fontWeight: 700}}>X</span>=стабильный&nbsp;
                    <span style={{color: '#f59e0b', fontWeight: 700}}>Y</span>=умеренный&nbsp;
                    <span style={{color: '#ef4444', fontWeight: 700}}>Z</span>=нестабильный спрос
                  </span>
                </div>
                <div className="table-scroll-hint"><div className="table-pan-x">
                  <table>
                    <thead>
                      <tr>
                        <th style={{width: 24}} title="Статус"></th>
                        <th>Товар</th>
                        <th title="ABC — по объёму продаж. XYZ — по стабильности спроса. Наведи на значок для деталей.">Кл. ⓘ</th>
                        <th style={{textAlign: 'right'}}>Остаток</th>
                        <th style={{textAlign: 'right'}}>Закупить</th>
                        <th style={{width: 40}}></th>
                        <th style={{width: 90}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {recPagedItems.map(row => (
                        <tr key={row.id} style={{
                          background: row.status === 'urgent_order' ? 'rgba(239,68,68,.07)'
                            : row.status === 'pre_season_order' ? 'rgba(245,158,11,.07)'
                            : undefined,
                        }}>
                          <td style={{paddingRight: 0}}><StatusDot status={row.status} /></td>
                          <td>
                            <div className="sku">{row.sku_name}</div>
                            <div className="meta" style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                              {row.item_ref && <span>{row.item_ref}</span>}
                              {row.pre_season_flag === 1 && <span style={{color: '#f59e0b', fontWeight: 600}}>⚡ предсезон</span>}
                            </div>
                          </td>
                          <td><ClassBadge abc={row.abc_class} xyz={row.xyz_class} /></td>
                          <td style={{textAlign: 'right'}}>{currency.format(row.available_qty)}</td>
                          <td style={{textAlign: 'right', fontWeight: 700, fontSize: '1.05em'}}>{currency.format(row.to_order)}</td>
                          <td>
                            <button
                              title="Почему такое количество?"
                              onClick={() => setExplainRow(row)}
                              style={{background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#64748b', cursor: 'pointer', padding: '2px 8px', fontSize: '0.8em'}}>
                              ?
                            </button>
                          </td>
                          <td>
                            <button
                              onClick={() => addRecommendationToDraft(row)}
                              disabled={addingId === row.id}
                              style={{
                                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: addingId === row.id ? 'default' : 'pointer',
                                fontWeight: 600, fontSize: '0.82em', transition: 'background .2s',
                                background: addedIds.has(row.id) ? '#22c55e' : '#2563eb',
                                color: '#fff',
                              }}>
                              {addingId === row.id ? '…' : addedIds.has(row.id) ? '✓ Добавлен' : 'Добавить'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>
                {recTotalPages > 1 && (
                  <div className="inline-actions" style={{marginTop: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8}}>
                    <button className="ghost-btn" disabled={recPage === 0} onClick={() => setRecPage(p => p - 1)}>← Назад</button>
                    <span className="meta">Стр. {recPage + 1} из {recTotalPages} · {filteredRecs.length} позиций</span>
                    <button className="ghost-btn" disabled={recPage >= recTotalPages - 1} onClick={() => setRecPage(p => p + 1)}>Вперёд →</button>
                  </div>
                )}
              </section>
            )}

            {/* search results — multi mode */}
            {currentDraft.batch.draft_mode === 'multi' && (
              <section className="card search-card">
                <div className="search-results">
                  {searchResults.map(row => (
                    <div key={row.id} className="search-item">
                      <div style={{display: 'flex', alignItems: 'flex-start', gap: 10}}>
                        <StatusDot status={row.status} />
                        <div>
                          <strong>{row.sku_name}</strong>
                          <div className="meta">{row.supplier_name} · рекомендовано {row.to_order} шт</div>
                          {row.pre_season_flag === 1 && <div style={{color: '#f59e0b', fontSize: '0.8em'}}>⚡ предсезон</div>}
                        </div>
                      </div>
                      <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                        <button onClick={() => setExplainRow(row)} style={{background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#64748b', cursor: 'pointer', padding: '4px 10px', fontSize: '0.82em'}}>?</button>
                        <button className="primary ghost" onClick={() => addRecommendationToDraft(row)}>Добавить</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* draft items */}
            <section ref={draftItemsRef} className="card orders-card">
              <div className="section-head">
                <div><span className="eyebrow">Текущая заявка</span><h2>Добавленные товары</h2></div>
                <label style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                  <span className="meta">Поиск</span>
                  <input value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Фильтр" style={{padding: '4px 8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f1f5f9'}} />
                </label>
              </div>
              <div className="search-results">
                {filteredCurrentItems.map(item => (
                  <div key={item.id} className="search-item">
                    <div>
                      <strong>{item.sku_name}</strong>
                      <div className="meta">
                        Система: {item.recommended_qty} шт
                        {item.manager_qty !== item.recommended_qty && (
                          <span style={{color: item.manager_qty < item.recommended_qty ? '#ef4444' : '#22c55e', marginLeft: 8, fontWeight: 600}}>
                            → Менеджер: {item.manager_qty} шт
                          </span>
                        )}
                        {item.reason && <span style={{color: '#94a3b8', marginLeft: 8}}>— {item.reason}</span>}
                      </div>
                    </div>
                    <div className="inline-actions">
                      <button
                        title="Изменить количество"
                        onClick={() => setEditQtyState({item})}
                        style={{padding: '5px 12px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85em'}}>
                        ✏ {item.manager_qty} шт
                      </button>
                      <button className="danger-btn" onClick={() => removeDraftItem(item.id)}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card footer-actions">
              <button className="ghost-btn" onClick={() => { setTab('drafts'); navigateToTab('drafts'); }}>В драфты</button>
              <button className="primary ghost" onClick={submitDraft}>Создать заявку →</button>
            </section>
          </>
        )}

        {/* ── DRAFTS TAB ─────────────────────────────────────────────────── */}
        {tab === 'drafts' && (
          <section className="card orders-card">
            <div className="section-head"><div><span className="eyebrow">Драфты</span><h2>Незавершённые заявки</h2></div></div>
            <div className="orders-grid">
              {drafts.map(d => (
                <article key={d.id} className="order-tile">
                  <div>
                    <div className="status-badge">draft</div>
                    <h3>#{d.id} · {d.draft_mode}</h3>
                    <p>{d.items_count} позиций · {currency.format(d.total_qty || 0)} шт</p>
                    <span className="meta">{new Date(d.created_at).toLocaleString('ru-RU')}</span>
                  </div>
                  <button className="primary ghost" onClick={() => openDraft(d.id)}>Открыть</button>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ── ORDERS TAB ─────────────────────────────────────────────────── */}
        {tab === 'orders' && (
          <section className="card orders-card">
            <div className="section-head"><div><span className="eyebrow">Заявки</span><h2>Созданные заявки</h2></div></div>
            <div className="orders-grid">
              {orders.map(order => (
                <article key={order.id} className="order-tile">
                  <div>
                    <div className="status-badge">{order.status}</div>
                    <h3>{order.supplier_name}</h3>
                    <p>{order.items_count} позиций · {currency.format(order.total_qty)}</p>
                    <span className="meta">{new Date(order.created_at).toLocaleString('ru-RU')}</span>
                  </div>
                  <div className="inline-actions">
                    <button className="primary ghost" onClick={() => openOrderDetail(order.id)}>Открыть</button>
                    <button className="primary ghost" disabled={order.status === 'completed'}
                      onClick={() => fetchJSON(apiUrl(`/api/orders/${order.id}/complete`), {method: 'POST'}).then(loadOrders)}>
                      {order.status === 'completed' ? 'Выполнена' : 'Выполнить'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {openOrder && (
              <div className="card search-card" style={{marginTop: 16}}>
                <div className="section-head"><div><span className="eyebrow">Состав заявки</span><h2>#{openOrder.batch.id} · {openOrder.batch.supplier_name}</h2><div className="meta">{openOrder.items.length} позиций</div></div>
                  <button className="ghost-btn" style={{alignSelf: 'flex-start'}} onClick={() => setOpenOrder(null)}>✕ Закрыть</button>
                </div>
                <div className="search-results">
                  {orderPagedItems.map(item => (
                    <div key={item.id} className="search-item">
                      <div>
                        <strong>{item.sku_name}</strong>
                        <div className="meta">{item.final_qty} шт{item.reason ? ` · ${item.reason}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {openOrder.items.length > ORDER_PAGE_SIZE && (
                  <div className="inline-actions" style={{marginTop: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8}}>
                    <button className="ghost-btn" disabled={orderPage === 0} onClick={() => setOrderPage(p => p - 1)}>← Назад</button>
                    <span className="meta">Стр. {orderPage + 1} из {Math.ceil(openOrder.items.length / ORDER_PAGE_SIZE)}</span>
                    <button className="ghost-btn" disabled={(orderPage + 1) * ORDER_PAGE_SIZE >= openOrder.items.length} onClick={() => setOrderPage(p => p + 1)}>Вперёд →</button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── NON-LIQUID TAB ─────────────────────────────────────────────── */}
        {tab === 'nonLiquid' && (
          <section className="card orders-card">
            <div className="section-head">
              <div>
                <span className="eyebrow">Неликвиды</span>
                <h2>Нет продаж за последние 4 месяца</h2>
                <div className="meta">Показано {nonLiquidItems.length} из {currency.format(nonLiquidTotal)}</div>
              </div>
            </div>
            <div className="inline-grid">
              <label>
                <span>Фильтр по группе</span>
                <select value={nonLiquidGroup} onChange={e => { setNonLiquidOffset(0); setNonLiquidGroup(e.target.value); }}>
                  <option value="">Все группы</option>
                  {nonLiquidGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>
                <span>Поиск по товару</span>
                <input value={nonLiquidSearch} onChange={e => { setNonLiquidOffset(0); setNonLiquidSearch(e.target.value); }} placeholder="Название / артикул" />
              </label>
            </div>
            {nonLiquidLoading && <div className="loading-block"><div className="spinner" /><span>Загружаю…</span></div>}
            <div className="table-scroll-hint"><div className="table-pan-x">
              <table>
                <thead>
                  <tr>
                    <th>Рейтинг</th>
                    <th>Группа</th>
                    <th>Товар</th>
                    <th style={{textAlign: 'right'}}>Остаток</th>
                    <th>Последняя продажа</th>
                    <th>Дней назад</th>
                    <th>Сезонность</th>
                    <th>Магазин</th>
                  </tr>
                </thead>
                <tbody>
                  {nonLiquidItems.map((row, idx) => {
                    const score = row.nlq_score ?? 0;
                    const scoreBg = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#22c55e';
                    return (
                      <tr key={`${row.norm_name}-${row.store_ref}-${idx}`}>
                        <td>
                          <span style={{display: 'inline-block', minWidth: 38, textAlign: 'center', padding: '2px 6px', borderRadius: 4, background: scoreBg, color: '#fff', fontWeight: 700, fontSize: '0.85em'}}>
                            {score}
                          </span>
                        </td>
                        <td>{row.subgroup || 'Без группы'}</td>
                        <td><div className="sku">{row.sku_name}</div><div className="meta">{row.item_ref || '—'}</div></td>
                        <td style={{textAlign: 'right'}}>{currency.format(row.available_qty || 0)}</td>
                        <td>{row.last_sale_date ? new Date(row.last_sale_date).toLocaleDateString('ru-RU') : 'не было'}</td>
                        <td>{row.days_since_last_sale != null ? `${row.days_since_last_sale} дн.` : '—'}</td>
                        <td>
                          {row.is_seasonal
                            ? <span style={{color: '#f59e0b', fontWeight: 600}} title={row.season_note || ''}>🌿 {row.season_note || 'сезонный'}</span>
                            : <span style={{color: '#475569'}}>—</span>}
                        </td>
                        <td>{row.store}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div></div>
            <div className="inline-actions" style={{marginTop: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12}}>
              <button className="ghost-btn" disabled={nonLiquidOffset === 0 || nonLiquidLoading} onClick={() => setNonLiquidOffset(Math.max(0, nonLiquidOffset - nonLiquidLimit))}>← Назад</button>
              <span className="meta">Стр. {Math.floor(nonLiquidOffset / nonLiquidLimit) + 1} из {Math.max(1, Math.ceil(nonLiquidTotal / nonLiquidLimit))} · по {nonLiquidLimit} шт.</span>
              <button className="ghost-btn" disabled={!nonLiquidHasMore || nonLiquidLoading} onClick={() => setNonLiquidOffset(nonLiquidOffset + nonLiquidLimit)}>Вперёд →</button>
            </div>
          </section>
        )}

        {/* ── CATALOG TAB ────────────────────────────────────────────────── */}
        {tab === 'catalog' && (
          <section className="card orders-card">
            <div className="section-head">
              <div>
                <span className="eyebrow">Каталог товаров</span>
                <h2>Все товары</h2>
                <div className="meta">Показано {catalogItems.length} из {currency.format(catalogTotal)}</div>
              </div>
            </div>
            <div className="inline-grid" style={{gap: 8, flexWrap: 'wrap'}}>
              <label>
                <span>Поиск (название / штрихкод)</span>
                <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Название или штрихкод" />
              </label>
              <label>
                <span>Группа</span>
                <select value={catalogGroup} onChange={e => { setCatalogOffset(0); setCatalogGroup(e.target.value); }}>
                  <option value="">Все группы</option>
                  {catalogGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>
                <span>Поставщик</span>
                <select value={catalogSupplier} onChange={e => { setCatalogOffset(0); setCatalogSupplier(e.target.value); }}>
                  <option value="">Все поставщики</option>
                  {suppliers.map(s => <option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}
                </select>
              </label>
            </div>
            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8}}>
              {([
                ['to_order', 'К заказу'],
                ['sku_name', 'Название'],
                ['available_qty', 'Остаток'],
                ['abc_class', 'ABC'],
                ['xyz_class', 'XYZ'],
                ['last_sale_date', 'Посл. продажа'],
                ['days_since_last_sale', 'Дней без продаж'],
                ['nlq_score', 'Рейтинг неликв.'],
                ['status', 'Статус'],
              ] as [string, string][]).map(([key, label]) => (
                <button key={key}
                  onClick={() => {
                    if (catalogSortBy === key) { setCatalogSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
                    else { setCatalogSortBy(key); setCatalogSortDir('desc'); }
                    setCatalogOffset(0);
                  }}
                  style={{
                    padding: '3px 10px', borderRadius: 6, border: '1px solid #334155',
                    background: catalogSortBy === key ? '#2563eb' : '#0f172a',
                    color: catalogSortBy === key ? '#fff' : '#94a3b8',
                    cursor: 'pointer', fontSize: '0.78em', fontWeight: catalogSortBy === key ? 700 : 400,
                  }}>
                  {label} {catalogSortBy === key ? (catalogSortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              ))}
            </div>
            {catalogLoading && <div className="loading-block"><div className="spinner" /><span>Загружаю…</span></div>}
            <div className="table-scroll-hint"><div className="table-pan-x">
              <table>
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Штрихкод</th>
                    <th>Группа</th>
                    <th>Поставщик</th>
                    <th title="ABC — по объёму, XYZ — по стабильности спроса">Кл.</th>
                    <th style={{textAlign: 'right'}}>Остаток</th>
                    <th style={{textAlign: 'right'}}>К заказу</th>
                    <th>Статус</th>
                    <th>Посл. продажа</th>
                    <th>Дней без продаж</th>
                    <th>Сезонность</th>
                    <th>Рейтинг НЛ</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogItems.map((row, idx) => {
                    const score = row.nlq_score ?? 0;
                    const scoreBg = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#22c55e';
                    return (
                      <tr key={`${row.sku_name}-${idx}`} style={{
                        background: row.status === 'urgent_order' ? 'rgba(239,68,68,.07)'
                          : row.status === 'pre_season_order' ? 'rgba(245,158,11,.07)'
                          : undefined,
                      }}>
                        <td>
                          <div className="sku">{row.sku_name}</div>
                          {row.item_ref && row.item_ref !== row.sku_name && <div className="meta">{row.item_ref}</div>}
                        </td>
                        <td style={{fontFamily: 'monospace', fontSize: '0.8em', color: '#64748b'}}>{row.barcode || '—'}</td>
                        <td style={{fontSize: '0.85em'}}>{row.subgroup || '—'}</td>
                        <td style={{fontSize: '0.82em'}}>{row.supplier_name || '—'}</td>
                        <td><ClassBadge abc={row.abc_class || ''} xyz={row.xyz_class || ''} /></td>
                        <td style={{textAlign: 'right'}}>{currency.format(row.available_qty || 0)}</td>
                        <td style={{textAlign: 'right', fontWeight: 700, color: row.to_order ? '#f1f5f9' : '#475569'}}>
                          {row.to_order ? currency.format(row.to_order) : '—'}
                        </td>
                        <td>{row.status ? <StatusDot status={row.status} /> : '—'}</td>
                        <td style={{fontSize: '0.85em'}}>{row.last_sale_date ? new Date(row.last_sale_date).toLocaleDateString('ru-RU') : '—'}</td>
                        <td style={{textAlign: 'right', color: (row.days_since_last_sale ?? 0) > 120 ? '#ef4444' : '#f1f5f9', fontSize: '0.85em'}}>
                          {row.days_since_last_sale != null ? `${row.days_since_last_sale} дн.` : '—'}
                        </td>
                        <td>
                          {row.is_seasonal
                            ? <span style={{color: '#f59e0b', fontSize: '0.8em'}} title={row.season_note || ''}>🌿 {row.season_note || 'сезон'}</span>
                            : <span style={{color: '#475569', fontSize: '0.8em'}}>—</span>}
                        </td>
                        <td>
                          {row.nlq_score != null
                            ? <span style={{display: 'inline-block', minWidth: 32, textAlign: 'center', padding: '1px 5px', borderRadius: 4, background: scoreBg, color: '#fff', fontWeight: 700, fontSize: '0.8em'}}>{score}</span>
                            : <span style={{color: '#475569'}}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div></div>
            <div className="inline-actions" style={{marginTop: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12}}>
              <button className="ghost-btn" disabled={catalogOffset === 0 || catalogLoading} onClick={() => setCatalogOffset(Math.max(0, catalogOffset - CATALOG_LIMIT))}>← Назад</button>
              <span className="meta">Стр. {Math.floor(catalogOffset / CATALOG_LIMIT) + 1} из {Math.max(1, Math.ceil(catalogTotal / CATALOG_LIMIT))} · по {CATALOG_LIMIT} шт.</span>
              <button className="ghost-btn" disabled={!catalogHasMore || catalogLoading} onClick={() => setCatalogOffset(catalogOffset + CATALOG_LIMIT)}>Вперёд →</button>
            </div>
          </section>
        )}

        {/* ── DECISIONS TAB ──────────────────────────────────────────────── */}
        {tab === 'decisions' && (
          <section className="card orders-card">
            <div className="section-head"><div><span className="eyebrow">Контроль качества закупок</span><h2>Решения менеджеров</h2><div className="meta">Отклонения от системных рекомендаций</div></div></div>
            <div className="table-scroll-hint"><div className="table-pan-x">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Менеджер</th>
                    <th>Товар</th>
                    <th style={{textAlign: 'right'}}>Система</th>
                    <th style={{textAlign: 'right'}}>Менеджер</th>
                    <th style={{textAlign: 'right'}}>Δ</th>
                    <th>Причина</th>
                    <th>Поставщик</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d, i) => (
                    <tr key={i}>
                      <td>{new Date(d.decision_date).toLocaleDateString('ru-RU')}</td>
                      <td>{d.manager_name}</td>
                      <td><div className="sku">{d.sku_name}</div></td>
                      <td style={{textAlign: 'right'}}>{d.system_qty}</td>
                      <td style={{textAlign: 'right', fontWeight: 700, color: d.manager_qty < d.system_qty ? '#ef4444' : d.manager_qty > d.system_qty ? '#22c55e' : '#f1f5f9'}}>{d.manager_qty}</td>
                      <td style={{textAlign: 'right', color: d.delta_qty < 0 ? '#ef4444' : d.delta_qty > 0 ? '#22c55e' : '#94a3b8'}}>{d.delta_qty > 0 ? '+' : ''}{d.delta_qty}</td>
                      <td style={{maxWidth: 200, fontSize: '0.85em', color: '#94a3b8'}}>{d.reason || '—'}</td>
                      <td style={{fontSize: '0.85em'}}>{d.supplier_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          </section>
        )}

        {/* ── CATALOG2 TAB ─────────────────────────────────────────────── */}
        {tab === 'catalog2' && (
          <div style={{display: 'flex', height: '100%', overflow: 'hidden'}}>

            {/* Left tree panel */}
            <div style={{
              width: c2TreeOpen ? 260 : 0, flexShrink: 0, display: 'flex', flexDirection: 'column',
              background: '#0a1628', borderRight: c2TreeOpen ? '1px solid #1e293b' : 'none',
              overflow: 'hidden', transition: 'width .22s ease',
            }}>
              <div style={{padding: '10px 10px 8px', borderBottom: '1px solid #1e293b', flexShrink: 0}}>
                <div style={{fontSize: '0.68em', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6}}>Группы товаров</div>
                <input
                  style={{width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, color: '#f1f5f9', padding: '4px 8px', fontSize: '0.8em', outline: 'none'}}
                  placeholder="Поиск группы…"
                  value={c2TreeSearch}
                  onChange={e => setC2TreeSearch(e.target.value)}
                />
              </div>

              {c2TreeSearch.length >= 2 ? (
                <div style={{overflowY: 'auto', flex: 1, padding: '4px 4px'}}>
                  {c2TreeSearchResults.length === 0
                    ? <div style={{padding: '16px 8px', color: '#334155', fontSize: '0.8em', textAlign: 'center'}}>Не найдено</div>
                    : c2TreeSearchResults.map((r, idx) => (
                        <div key={idx}
                          onClick={() => { setC2Path(r.path); setC2TreeSearch(''); }}
                          style={{padding: '5px 8px', borderRadius: 5, cursor: 'pointer', marginBottom: 1, background: c2Path === r.path ? '#1d4ed8' : 'transparent', fontSize: '0.78em'}}
                        >
                          <div style={{color: c2Path === r.path ? '#fff' : '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={r.path}>
                            {'·'.repeat(r.depth + 1)} {r.name}
                          </div>
                          <div style={{color: '#334155', fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                            {r.path} · {r.item_count.toLocaleString('ru-RU')} тов.
                          </div>
                        </div>
                      ))
                  }
                </div>
              ) : (
              <div style={{overflowY: 'auto', flex: 1, padding: '6px 4px'}}>
                {/* All items root */}
                <div
                  onClick={() => { setC2Path(''); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '5px 8px', borderRadius: 5, cursor: 'pointer', marginBottom: 2,
                    background: c2Path === '' ? '#1d4ed8' : 'transparent',
                    fontSize: '0.82em', fontWeight: 600,
                  }}
                >
                  <span style={{color: c2Path === '' ? '#fff' : '#94a3b8'}}>Все товары</span>
                  <span style={{color: '#334155', fontSize: '0.78em'}}>{c2Total.toLocaleString('ru-RU')}</span>
                </div>

                {/* Tree nodes */}
                {!c2TreeCache.has('') && (
                  <div style={{padding: '16px 8px', color: '#334155', fontSize: '0.8em', textAlign: 'center'}}>Загрузка…</div>
                )}
                {c2VisibleNodes.map(node => (
                  <div key={node.path} style={{paddingLeft: node.depth * 14}}>
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 3,
                        padding: '4px 8px', borderRadius: 5, cursor: 'pointer',
                        background: c2Path === node.path ? '#1d4ed8' : 'transparent',
                        fontSize: '0.8em',
                      }}
                      onClick={() => {
                        setC2Path(node.path);
                        if (node.hasChildren) c2ToggleExpand(node.path);
                      }}
                    >
                      <span style={{width: 12, color: '#334155', fontSize: '0.85em', flexShrink: 0}}>
                        {node.hasChildren ? (node.isExpanded ? '▾' : '▸') : '·'}
                      </span>
                      <span style={{flex: 1, color: c2Path === node.path ? '#fff' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={node.name}>
                        {node.name}
                      </span>
                      <span style={{color: '#334155', fontSize: '0.75em', flexShrink: 0, marginLeft: 4}}>{node.itemCount.toLocaleString('ru-RU')}</span>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>

            {/* Right: product list */}
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
              {/* Toolbar */}
              <div style={{padding: '10px 14px 8px', borderBottom: '1px solid #1e293b', background: '#0a1628', flexShrink: 0}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6}}>
                  {/* Tree toggle + Breadcrumb */}
                  <div style={{display:'flex', gap:6, alignItems:'center'}}>
                  {analyticsReturnPath && (
                    <button
                      onClick={() => { setTab('analytics'); navigateToTab('analytics'); }}
                      className="ghost-btn"
                      style={{padding:'3px 8px', fontSize:'0.8em'}}
                    >← Назад к аналитике</button>
                  )}
                  <button
                    onClick={() => setC2TreeOpen(v => !v)}
                    title={c2TreeOpen ? 'Скрыть дерево' : 'Показать дерево'}
                    style={{
                      background: 'none', border: '1px solid #1e293b', borderRadius: 6,
                      color: '#475569', cursor: 'pointer', padding: '3px 8px', fontSize: '0.8em',
                      flexShrink: 0,
                    }}
                  >{c2TreeOpen ? '◀ Дерево' : '▶ Дерево'}</button>
                  </div>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', fontSize: '0.78em', color: '#475569', maxWidth: '60%'}}>
                    <span
                      style={{cursor: 'pointer', color: c2Path === '' ? '#f1f5f9' : '#3b82f6', fontWeight: c2Path === '' ? 700 : 400}}
                      onClick={() => setC2Path('')}
                    >Все</span>
                    {c2Path.split(' / ').filter(Boolean).map((part, i, arr) => {
                      const pathTo = c2Path.split(' / ').slice(0, i + 1).join(' / ');
                      const isLast = i === arr.length - 1;
                      return (
                        <span key={pathTo} style={{display: 'flex', alignItems: 'center', gap: 2}}>
                          <span style={{color: '#1e293b'}}>/</span>
                          <span
                            style={{cursor: isLast ? 'default' : 'pointer', color: isLast ? '#f1f5f9' : '#3b82f6', fontWeight: isLast ? 600 : 400, whiteSpace: 'nowrap'}}
                            onClick={() => !isLast && setC2Path(pathTo)}
                          >{part}</span>
                        </span>
                      );
                    })}
                  </div>
                  <span style={{color: '#334155', fontSize: '0.78em', flexShrink: 0}}>
                    {c2Total.toLocaleString('ru-RU')} товаров
                  </span>
                </div>
                <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                  <input
                    style={{flex: 1, boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', borderRadius: 7, color: '#f1f5f9', padding: '6px 12px', fontSize: '0.84em', outline: 'none'}}
                    placeholder="Поиск по названию, коду, штрихкоду…"
                    value={c2Search}
                    onChange={e => setC2Search(e.target.value)}
                  />
                  <label style={{display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'pointer', userSelect: 'none'}}>
                    <input
                      type="checkbox"
                      checked={c2HasStock}
                      onChange={e => { setC2HasStock(e.target.checked); setC2Offset(0); }}
                      style={{width: 14, height: 14, accentColor: '#22c55e', cursor: 'pointer'}}
                    />
                    <span style={{color: '#64748b', fontSize: '0.8em', whiteSpace: 'nowrap'}}>Только с остатком</span>
                  </label>
                </div>
              </div>

              {/* Table */}
              <div style={{flex: 1, overflowY: 'auto', position: 'relative'}}>
                {c2Loading && (
                  <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,22,40,.6)', zIndex: 5}}>
                    <div className="spinner" />&nbsp;<span style={{color: '#64748b', fontSize: '0.88em'}}>Загрузка…</span>
                  </div>
                )}
                <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.83em'}}>
                  <thead>
                    <tr style={{background: '#0a1628', position: 'sticky', top: 0, zIndex: 4}}>
                      {([
                        {label: 'Название', key: 'item_name', right: false},
                        {label: 'Код / ШК', key: null, right: false},
                        {label: 'Подгруппа', key: 'parent_name', right: false},
                        {label: 'ABC·XYZ', key: 'abc_class', right: true},
                        {label: 'Остаток', key: 'qty', right: true},
                        {label: 'Нужно остатков', key: 'recommended_stock', right: true},
                        {label: 'Нужно заказать', key: 'to_order', right: true},
                        {label: 'Цена прод.', key: 'retail_price', right: true},
                        {label: 'Цена закуп.', key: 'purchase_price', right: true},
                        {label: 'Посл. продажа', key: 'last_sale_date', right: true},
                      ] as {label:string; key:string|null; right:boolean}[]).map(col => {
                        const active = col.key && c2SortBy === col.key;
                        return (
                          <th
                            key={col.label}
                            onClick={col.key ? () => {
                              if (c2SortBy === col.key) setC2SortDir(d => d === 'asc' ? 'desc' : 'asc');
                              else { setC2SortBy(col.key!); setC2SortDir('asc'); }
                              setC2Offset(0);
                            } : undefined}
                            style={{
                              padding: '7px 10px', textAlign: col.right ? 'right' : 'left',
                              color: active ? '#60a5fa' : '#475569',
                              fontWeight: 600, fontSize: '0.8em',
                              borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap',
                              cursor: col.key ? 'pointer' : 'default',
                              userSelect: 'none',
                            }}
                          >
                            {col.label}
                            {col.key && (active
                              ? <span style={{marginLeft: 3}}>{c2SortDir === 'asc' ? '↑' : '↓'}</span>
                              : <span style={{marginLeft: 3, color: '#1e293b'}}>↕</span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(c2SortBy === 'recommended_stock' || c2SortBy === 'to_order' ? [...c2Items].sort((a, b) => {
                      const fa = c2ForecastMap[String(a.id)];
                      const fb = c2ForecastMap[String(b.id)];
                      const recA = fa ? Math.max(0, Math.ceil((fa.forecast_day_matrix || 0) * ((fa.lead_time_days || 0) + (fa.order_cycle_days || 0)) + (fa.ss_total || 0))) : (a.recommended_stock ?? 0);
                      const recB = fb ? Math.max(0, Math.ceil((fb.forecast_day_matrix || 0) * ((fb.lead_time_days || 0) + (fb.order_cycle_days || 0)) + (fb.ss_total || 0))) : (b.recommended_stock ?? 0);
                      const ordA = fa ? Math.max(0, Math.ceil(recA - (a.qty || 0))) : Math.max(0, a.to_order ?? a.forecast_to_order ?? 0);
                      const ordB = fb ? Math.max(0, Math.ceil(recB - (b.qty || 0))) : Math.max(0, b.to_order ?? b.forecast_to_order ?? 0);
                      const dir = c2SortDir === 'asc' ? 1 : -1;
                      return (c2SortBy === 'recommended_stock' ? (recA - recB) : (ordA - ordB)) * dir;
                    }) : c2Items).map(item => {
                      const forecast = c2ForecastMap[String(item.id)];
                      const recommendedStock = forecast
                        ? Math.max(0, Math.ceil((forecast.forecast_day_matrix || 0) * ((forecast.lead_time_days || 0) + (forecast.order_cycle_days || 0)) + (forecast.ss_total || 0)))
                        : (item.recommended_stock ?? ((item.qty || 0) + Math.max(0, item.to_order ?? item.forecast_to_order ?? 0)));
                      const recommendedOrder = forecast
                        ? Math.max(0, Math.ceil(recommendedStock - (item.qty || 0)))
                        : Math.max(0, item.to_order ?? item.forecast_to_order ?? 0);
                      const days = item.days_since_last_sale;
                      const rowBase = days === null ? 'rgba(239,68,68,.09)'
                        : days >= 365 ? 'rgba(239,68,68,.09)'
                        : days >= 120 ? 'rgba(234,179,8,.07)'
                        : undefined;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setC2Modal(item)}
                          style={{cursor: 'pointer', borderBottom: '1px solid #0f172a', background: rowBase, transition: 'background .1s'}}
                          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#1e293b')}
                          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = rowBase || '')}
                        >
                          <td style={{padding: '7px 10px', maxWidth: 300, color: '#e2e8f0'}}>
                            <div style={{fontWeight: 500, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{item.item_name}</div>
                          </td>
                          <td style={{padding: '7px 10px', fontFamily: 'monospace', color: '#475569', fontSize: '0.85em', whiteSpace: 'nowrap'}}>
                            {item.item_code?.trim() && <div>{item.item_code.trim()}</div>}
                            {item.barcode && <div style={{color: '#334155'}}>{item.barcode}</div>}
                          </td>
                          <td style={{padding: '7px 10px', color: '#64748b', whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {item.parent_name || '—'}
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right'}}>
                            {(item.abc_class || item.xyz_class)
                              ? <ClassBadge abc={item.abc_class || ''} xyz={item.xyz_class || ''}/>
                              : <span style={{color: '#1e293b'}}>—</span>
                            }
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: item.qty > 0 ? '#22c55e' : '#334155'}}>
                            <div>{item.qty > 0 ? item.qty.toLocaleString('ru-RU') : '—'}</div>
                            {(recommendedOrder > 0) && <div style={{fontSize:'0.72em', color:'#f59e0b', fontWeight:700}}>рекомендуется дозакупить</div>}
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right', color: '#93c5fd', fontWeight: 600}}>
                            {recommendedStock > 0 ? Math.round(recommendedStock).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right'}}>
                            {recommendedOrder > 0
                              ? <span style={{display:'inline-block', padding:'2px 7px', borderRadius:999, background:'rgba(245,158,11,.14)', color:'#f59e0b', fontSize:'0.74em', fontWeight:700}}>{Math.round(recommendedOrder).toLocaleString('ru-RU')} шт</span>
                              : <span style={{color:'#334155'}}>—</span>}
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right', color: '#e2e8f0'}}>
                            {item.retail_price > 0 ? item.retail_price.toLocaleString('ru-RU') + ' ₽' : '—'}
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right', color: '#64748b'}}>
                            {item.purchase_price > 0 ? item.purchase_price.toLocaleString('ru-RU') + ' ₽' : '—'}
                          </td>
                          <td style={{padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap'}}>
                            {item.last_sale_date
                              ? <div>
                                  <div style={{color: '#94a3b8', fontSize: '0.9em'}}>{new Date(item.last_sale_date).toLocaleDateString('ru-RU')}</div>
                                  <div style={{
                                    color: days !== null && days >= 365 ? '#f87171' : days !== null && days >= 120 ? '#fbbf24' : '#475569',
                                    fontSize: '0.78em',
                                  }}>{days} дн. назад</div>
                                </div>
                              : <span style={{color: '#ef4444', fontSize: '0.85em'}}>не было</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                    {!c2Loading && !c2Items.length && (
                      <tr>
                        <td colSpan={10} style={{padding: '40px 16px', textAlign: 'center', color: '#334155'}}>Товары не найдены</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 14px', borderTop: '1px solid #1e293b', background: '#0a1628',
                fontSize: '0.8em', flexShrink: 0,
              }}>
                <button
                  className="ghost-btn"
                  disabled={c2Offset === 0 || c2Loading}
                  onClick={() => { const o = Math.max(0, c2Offset - 50); setC2Offset(o); c2LoadItems(c2Path, c2Search, o); }}
                >← Назад</button>
                <span style={{color: '#475569'}}>
                  {c2Total > 0 ? `${(c2Offset + 1).toLocaleString('ru-RU')}–${Math.min(c2Offset + c2Items.length, c2Total).toLocaleString('ru-RU')} из ${c2Total.toLocaleString('ru-RU')}` : '—'}
                </span>
                <button
                  className="ghost-btn"
                  disabled={!c2HasMore || c2Loading}
                  onClick={() => { const o = c2Offset + 50; setC2Offset(o); c2LoadItems(c2Path, c2Search, o); }}
                >Вперёд →</button>
              </div>
            </div>
          </div>
        )}

        {/* ── ANALYTICS TAB ─────────────────────────────────────────────── */}
        {tab === 'analytics' && (
          <AnalyticsPage initialPath={analyticsReturnPath} onOpenCatalog={async (path, analyticsPath) => { const resolved = await resolveCatalogPath(path || '', analyticsPath || ''); setAnalyticsReturnPath(analyticsPath || path || ''); setC2Path(resolved || path || ''); setTab('catalog2'); navigateToTab('catalog2'); }}/>
        )}

      </main>
    </div>
  );
}
