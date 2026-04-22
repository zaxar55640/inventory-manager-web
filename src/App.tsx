import {useEffect, useMemo, useState} from 'react';
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

type CreateMode = 'single' | 'multi';
type TabKey = 'create' | 'drafts' | 'orders' | 'nonLiquid' | 'decisions';

const currency = new Intl.NumberFormat('ru-RU');

// ── helpers ───────────────────────────────────────────────────────────────────

function getTabFromLocation(): TabKey {
  const hash = (window.location.hash || '').replace(/^#/, '').replace(/\/$/, '');
  if (hash === '/non-liquid' || hash === 'non-liquid') return 'nonLiquid';
  if (hash === '/drafts' || hash === 'drafts') return 'drafts';
  if (hash === '/orders' || hash === 'orders') return 'orders';
  if (hash === '/decisions' || hash === 'decisions') return 'decisions';
  return 'create';
}

function navigateToTab(tab: TabKey) {
  const map: Record<TabKey, string> = {
    nonLiquid: '#/non-liquid',
    drafts: '#/drafts',
    orders: '#/orders',
    decisions: '#/decisions',
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
function ClassBadge({abc, xyz}: {abc: string; xyz: string}) {
  const abcColor: Record<string, string> = {A: '#22c55e', B: '#eab308', C: '#94a3b8'};
  const xyzColor: Record<string, string> = {X: '#22c55e', Y: '#f59e0b', Z: '#ef4444'};
  return (
    <span style={{display: 'inline-flex', gap: 3, fontSize: '0.72em'}}>
      {abc && <span style={{background: abcColor[abc] || '#ccc', color: '#fff', borderRadius: 3, padding: '1px 5px', fontWeight: 700}}>{abc}</span>}
      {xyz && <span style={{background: xyzColor[xyz] || '#ccc', color: '#fff', borderRadius: 3, padding: '1px 5px', fontWeight: 700}}>{xyz}</span>}
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

// ── comment modal (mandatory when deviating from recommended qty) ─────────────

function CommentModal({sku, recommended, newQty, onConfirm, onCancel}: {
  sku: string; recommended: number; newQty: number;
  onConfirm: (comment: string) => void; onCancel: () => void;
}) {
  const [comment, setComment] = useState('');
  const hints = ['Поставщик везёт дольше обычного', 'Избыток на складе', 'Сезон заканчивается', 'Договорились с поставщиком об акции', 'Своё видение по спросу'];
  const valid = comment.trim().length >= 3;
  return (
    <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{background: '#1e293b', borderRadius: 12, padding: '28px 32px', maxWidth: 440, width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,.5)'}}>
        <div style={{fontSize: '0.75em', color: '#94a3b8', marginBottom: 6}}>Вы меняете количество</div>
        <div style={{fontWeight: 700, fontSize: '1em', color: '#f1f5f9', marginBottom: 4}}>{sku}</div>
        <div style={{color: '#94a3b8', fontSize: '0.9em', marginBottom: 16}}>
          Система: <strong style={{color: '#f1f5f9'}}>{recommended} шт</strong>
          {' → '}
          Вы: <strong style={{color: newQty < recommended ? '#ef4444' : '#22c55e'}}>{newQty} шт</strong>
        </div>
        <label style={{display: 'block', fontSize: '0.85em', color: '#94a3b8', marginBottom: 6}}>Укажите причину <span style={{color: '#ef4444'}}>*</span></label>
        <textarea
          autoFocus
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Напишите причину изменения…"
          rows={3}
          style={{width: '100%', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#f1f5f9', padding: '10px 12px', fontSize: '0.95em', resize: 'vertical', boxSizing: 'border-box'}}
        />
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, marginBottom: 4}}>
          {hints.map(h => (
            <button key={h} onClick={() => setComment(h)}
              style={{padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78em'}}>
              {h}
            </button>
          ))}
        </div>
        <div style={{display: 'flex', gap: 10, marginTop: 16}}>
          <button onClick={onCancel} style={{flex: 1, padding: '10px 0', borderRadius: 8, background: '#334155', color: '#f1f5f9', border: 'none', cursor: 'pointer'}}>Отмена</button>
          <button onClick={() => valid && onConfirm(comment.trim())} disabled={!valid}
            style={{flex: 2, padding: '10px 0', borderRadius: 8, background: valid ? '#2563eb' : '#334155', color: '#f1f5f9', border: 'none', cursor: valid ? 'pointer' : 'not-allowed', fontWeight: 700}}>
            Подтвердить
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

  // explain modal
  const [explainRow, setExplainRow] = useState<Recommendation | null>(null);

  // comment modal for qty deviation
  const [commentState, setCommentState] = useState<{item: DraftItem; newQty: number; recommended: number} | null>(null);

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
  }

  // ── effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp; tg?.ready?.(); tg?.expand?.();
    const onHash = () => setTab(getTabFromLocation());
    window.addEventListener('hashchange', onHash);
    (async () => {
      try {
        await Promise.all([loadSuppliers(), loadOrders(), loadDrafts(), loadDashboard(), loadNonLiquidGroups()]);
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
  }, [tab]);

  // ── draft actions ─────────────────────────────────────────────────────────

  async function startDraft(nextMode: CreateMode) {
    const created = await fetchJSON<{id: number}>(apiUrl('/api/drafts'), {method: 'POST', body: JSON.stringify({draft_mode: nextMode})});
    await loadDrafts();
    await openDraft(created.id);
  }

  async function addRecommendationToDraft(row: Recommendation) {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items`), {
      method: 'POST',
      body: JSON.stringify({item: {recommendation_id: row.id, manager_qty: row.to_order, reason: '', supplier_name: row.supplier_name}}),
    });
    await openDraft(currentDraft.batch.id);
  }

  function requestQtyChange(item: DraftItem, newQty: number) {
    const recommended = item.recommended_qty;
    if (newQty !== recommended) {
      setCommentState({item, newQty, recommended});
    } else {
      applyQtyChange(item, newQty, '');
    }
  }

  async function applyQtyChange(item: DraftItem, newQty: number, reason: string) {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items/${item.id}`), {
      method: 'POST',
      body: JSON.stringify({manager_qty: newQty, reason}),
    });
    await openDraft(currentDraft.batch.id);
    setCommentState(null);
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
    const q = listSearch.toLowerCase();
    return recommendations.filter(r => !q || r.sku_name.toLowerCase().includes(q));
  }, [recommendations, listSearch]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="shell">
      {/* modals */}
      {explainRow && <ExplainModal row={explainRow} onClose={() => setExplainRow(null)} />}
      {commentState && (
        <CommentModal
          sku={commentState.item.sku_name}
          recommended={commentState.recommended}
          newQty={commentState.newQty}
          onConfirm={reason => applyQtyChange(commentState.item, commentState.newQty, reason)}
          onCancel={() => setCommentState(null)}
        />
      )}

      <aside className="rail">
        <div className="brand">
          <span className="eyebrow">Zakup Manager</span>
          <h1>Закупки</h1>
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
                <div className="table-scroll-hint"><div className="table-pan-x">
                  <table>
                    <thead>
                      <tr>
                        <th style={{width: 24}} title="Статус"></th>
                        <th>Товар</th>
                        <th>Кл.</th>
                        <th style={{textAlign: 'right'}}>Остаток</th>
                        <th style={{textAlign: 'right'}}>Закупить</th>
                        <th style={{width: 40}}></th>
                        <th style={{width: 90}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecs.map(row => (
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
                            <button className="primary ghost" onClick={() => addRecommendationToDraft(row)}>Добавить</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>
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
            <section className="card orders-card">
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
                      <input
                        type="number"
                        min={0}
                        value={item.manager_qty}
                        style={{width: 70}}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (!isNaN(v) && v >= 0) requestQtyChange(item, v);
                        }}
                      />
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
                <div className="section-head"><div><span className="eyebrow">Состав заявки</span><h2>#{openOrder.batch.id} · {openOrder.batch.supplier_name}</h2></div></div>
                <div className="search-results">
                  {openOrder.items.map(item => (
                    <div key={item.id} className="search-item">
                      <div>
                        <strong>{item.sku_name}</strong>
                        <div className="meta">{item.final_qty} шт{item.reason ? ` · ${item.reason}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
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
