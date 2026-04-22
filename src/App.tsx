import {useEffect, useMemo, useRef, useState} from 'react';
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

type CreateMode = 'single' | 'multi';
type TabKey = 'create' | 'drafts' | 'orders' | 'nonLiquid' | 'decisions' | 'catalog';

const currency = new Intl.NumberFormat('ru-RU');

// ── helpers ───────────────────────────────────────────────────────────────────

function getTabFromLocation(): TabKey {
  const hash = (window.location.hash || '').replace(/^#/, '').replace(/\/$/, '');
  if (hash === '/non-liquid' || hash === 'non-liquid') return 'nonLiquid';
  if (hash === '/drafts' || hash === 'drafts') return 'drafts';
  if (hash === '/orders' || hash === 'orders') return 'orders';
  if (hash === '/decisions' || hash === 'decisions') return 'decisions';
  if (hash === '/catalog' || hash === 'catalog') return 'catalog';
  return 'create';
}

function navigateToTab(tab: TabKey) {
  const map: Record<TabKey, string> = {
    nonLiquid: '#/non-liquid',
    drafts: '#/drafts',
    orders: '#/orders',
    decisions: '#/decisions',
    catalog: '#/catalog',
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
  A: 'A — топ 50% по объёму продаж. Высокий приоритет закупки.',
  B: 'B — следующие 30% по объёму. Средний приоритет.',
  C: 'C — оставшиеся 20%. Низкий приоритет, заказывать осторожно.',
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

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="shell">
      {/* modals */}
      {explainRow && <ExplainModal row={explainRow} onClose={() => setExplainRow(null)} />}
      {editQtyState && (
        <EditQtyModal
          item={editQtyState.item}
          onConfirm={(qty, reason) => applyQtyChange(editQtyState.item, qty, reason)}
          onCancel={() => setEditQtyState(null)}
        />
      )}

      <aside className="rail">
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
                    <span style={{color: '#22c55e', fontWeight: 700}}>A</span>=топ 50%&nbsp;
                    <span style={{color: '#eab308', fontWeight: 700}}>B</span>=30%&nbsp;
                    <span style={{color: '#94a3b8', fontWeight: 700}}>C</span>=20%&nbsp;&nbsp;
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

      </main>
    </div>
  );
}
