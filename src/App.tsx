import {useEffect, useMemo, useState} from 'react';
import {apiUrl} from './config';

type Supplier = {supplier_name: string; items_count: number; total_to_order: number; coverage_days?: number | null};
type Recommendation = {
  id: number;
  supplier_name: string;
  sku_name: string;
  item_ref: string;
  norm_name: string;
  available_qty: number;
  to_order: number;
  recommended_stock: number;
  demand_mode: string;
  coverage_days: number;
  coverage_source: string;
  system_note: string;
};
type DraftSummary = {id: number; supplier_name: string; status: string; created_at: string; draft_mode: 'single' | 'multi'; items_count: number; total_qty: number};
type OrderBatch = {id: number; supplier_name: string; status: string; created_at: string; items_count: number; total_qty: number};
type DraftItem = {id: number; recommendation_id: number; item_ref: string; sku_name: string; norm_name: string; recommended_qty: number; manager_qty: number; final_qty: number; reason: string};
type DraftDetail = {batch: DraftSummary; items: DraftItem[]};
type OrderDetail = {batch: {id: number; supplier_name: string; status: string; created_at: string}; items: Array<{id:number; sku_name:string; item_ref:string; recommended_qty:number; manager_qty:number; final_qty:number; reason:string; item_status:string}>};
type NonLiquidItem = {store: string; store_ref: string; item_ref: string; sku_name: string; norm_name: string; subgroup: string; available_qty: number; sales_qty_4m: number; last_sale_date: string | null; days_since_last_sale: number | null};

type CreateMode = 'single' | 'multi';
const currency = new Intl.NumberFormat('ru-RU');

export function App() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [orders, setOrders] = useState<OrderBatch[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [currentDraft, setCurrentDraft] = useState<DraftDetail | null>(null);
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);
  const [tab, setTab] = useState<'create' | 'drafts' | 'orders' | 'nonLiquid'>('create');
  const [mode, setMode] = useState<CreateMode | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Recommendation[]>([]);
  const [searchSupplierFilter, setSearchSupplierFilter] = useState('');
  const [supplierCoverageInput, setSupplierCoverageInput] = useState('');
  const [productCoverageInputs, setProductCoverageInputs] = useState<Record<string, string>>({});
  const [nonLiquidItems, setNonLiquidItems] = useState<NonLiquidItem[]>([]);
  const [nonLiquidGroups, setNonLiquidGroups] = useState<string[]>([]);
  const [nonLiquidGroup, setNonLiquidGroup] = useState('');
  const [nonLiquidSearch, setNonLiquidSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [nonLiquidLoading, setNonLiquidLoading] = useState(false);

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
  async function loadNonLiquidGroups() {
    setNonLiquidLoading(true);
    try {
      setNonLiquidGroups(await fetchJSON<string[]>(apiUrl('/api/non-liquid/groups')));
    } finally {
      setNonLiquidLoading(false);
    }
  }
  async function loadNonLiquidItems(group = nonLiquidGroup, q = nonLiquidSearch) {
    const params = new URLSearchParams();
    if (group) params.set('subgroup', group);
    if (q.trim()) params.set('q', q.trim());
    setNonLiquidLoading(true);
    try {
      setNonLiquidItems(await fetchJSON<NonLiquidItem[]>(apiUrl(`/api/non-liquid${params.toString() ? `?${params.toString()}` : ''}`)));
    } finally {
      setNonLiquidLoading(false);
    }
  }

  async function openDraft(id: number) {
    const detail = await fetchJSON<DraftDetail>(apiUrl(`/api/drafts/${id}`));
    setCurrentDraft(detail);
    setMode(detail.batch.draft_mode);
    setTab('create');
  }

  async function openOrderDetail(id: number) {
    setOpenOrder(await fetchJSON<OrderDetail>(apiUrl(`/api/orders/${id}`)));
  }

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp; tg?.ready?.(); tg?.expand?.();
    (async () => {
      await loadSuppliers();
      await loadOrders();
      await loadDrafts();
      await loadNonLiquidGroups();
      await loadNonLiquidItems('', '');
      const latest = await fetchJSON<DraftSummary | null>(apiUrl('/api/drafts/latest'));
      if (latest) {
        const resume = window.confirm('Хотите продолжить заполнение последней заявки? Нажмите Cancel, чтобы создать новую.');
        if (resume) await openDraft(latest.id);
      }
    })();
  }, []);

  useEffect(() => {
    const selected = suppliers.find((s) => s.supplier_name === selectedSupplier);
    setSupplierCoverageInput(selected?.coverage_days != null ? String(selected.coverage_days) : '');
  }, [suppliers, selectedSupplier]);

  useEffect(() => {
    if (!selectedSupplier || mode !== 'single') return;
    fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`)).then(setRecommendations);
  }, [selectedSupplier, mode]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return void setSearchResults([]);
    const t = setTimeout(async () => {
      const rows = await fetchJSON<Recommendation[]>(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
      setSearchResults(searchSupplierFilter ? rows.filter((r) => r.supplier_name === searchSupplierFilter) : rows);
    }, 250);
    return () => clearTimeout(t);
  }, [search, searchSupplierFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadNonLiquidItems(nonLiquidGroup, nonLiquidSearch);
    }, 200);
    return () => clearTimeout(t);
  }, [nonLiquidGroup, nonLiquidSearch]);

  async function startDraft(nextMode: CreateMode) {
    const created = await fetchJSON<{id:number}>(apiUrl('/api/drafts'), {method:'POST', body: JSON.stringify({draft_mode: nextMode})});
    await loadDrafts();
    await openDraft(created.id);
  }

  async function addRecommendationToDraft(row: Recommendation) {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items`), {method:'POST', body: JSON.stringify({item:{recommendation_id: row.id, manager_qty: row.to_order, reason:'', supplier_name: row.supplier_name}})});
    await openDraft(currentDraft.batch.id);
  }

  async function updateDraftItem(item: DraftItem, patch: Partial<DraftItem>) {
    if (!currentDraft) return;
    const next = {...item, ...patch};
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items/${item.id}`), {method:'POST', body: JSON.stringify({manager_qty: next.manager_qty, reason: next.reason})});
    await openDraft(currentDraft.batch.id);
  }

  async function removeDraftItem(itemId: number) {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/items/${itemId}`), {method:'DELETE'});
    await openDraft(currentDraft.batch.id);
    await loadDrafts();
  }

  async function submitDraft() {
    if (!currentDraft) return;
    await fetchJSON(apiUrl(`/api/drafts/${currentDraft.batch.id}/submit`), {method:'POST'});
    setCurrentDraft(null);
    await loadDrafts();
    await loadOrders();
    setTab('orders');
  }

  async function confirmSupplierCoverage() {
    if (!selectedSupplier) return;
    const value = supplierCoverageInput.trim();
    if (!confirm(`Подтвердить coverage для поставщика ${selectedSupplier}: ${value || 'пропустить'}?`)) return;
    await fetchJSON(apiUrl('/api/coverage/supplier'), {method:'POST', body: JSON.stringify({supplier_name:selectedSupplier, coverage_days: value ? Number(value) : null})});
    await loadSuppliers();
  }

  async function confirmProductCoverage(normName: string, skuName: string) {
    const value = (productCoverageInputs[normName] || '').trim();
    if (!confirm(`Подтвердить coverage для товара "${skuName}": ${value || 'пропустить'}?`)) return;
    await fetchJSON(apiUrl('/api/coverage/product'), {method:'POST', body: JSON.stringify({norm_name:normName, coverage_days: value ? Number(value) : null})});
  }

  const filteredCurrentItems = useMemo(() => {
    const items = currentDraft?.items || [];
    return items.filter((row) => row.sku_name.toLowerCase().includes(listSearch.toLowerCase()));
  }, [currentDraft, listSearch]);

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><span className="eyebrow">Telegram Web App</span><h1>Zakup Manager</h1><p>Черновики и заявки с продолжением работы.</p></div>
        <div className="panel">
          <button className={tab==='create'?'tab active':'tab'} onClick={() => { setTab('create'); if (!currentDraft) setMode(null); }}>Новая заявка</button>
          <button className={tab==='drafts'?'tab active':'tab'} onClick={() => setTab('drafts')}>Драфты</button>
          <button className={tab==='orders'?'tab active':'tab'} onClick={() => setTab('orders')}>Список заявок</button>
          <button className={tab==='nonLiquid'?'tab active':'tab'} onClick={() => setTab('nonLiquid')}>Неликвиды</button>
        </div>
      </aside>
      <main className="main">
        {tab === 'create' && !currentDraft && (
          <section className="hero card">
            <div><span className="eyebrow">Новая заявка</span><h2>Какую заявку создать?</h2><p>После выбора сразу создаём draft, который можно потом открыть и продолжить.</p></div>
            <div className="step-cards">
              <button className="step-card" onClick={() => startDraft('single')}><strong>Один поставщик</strong><span>Товары по одному поставщику.</span></button>
              <button className="step-card" onClick={() => startDraft('multi')}><strong>Несколько поставщиков</strong><span>Поиск по товарам + фильтр по поставщикам.</span></button>
            </div>
          </section>
        )}

        {tab === 'create' && currentDraft && (
          <>
            <section className="card search-card">
              <div className="section-head"><div><span className="eyebrow">Составление заявки</span><h2>Draft #{currentDraft.batch.id}</h2><div className="meta">Режим: {currentDraft.batch.draft_mode}</div></div></div>
              {currentDraft.batch.draft_mode === 'single' ? (
                <div className="inline-grid">
                  <label><span>Поставщик</span><select value={selectedSupplier} onChange={(e)=>setSelectedSupplier(e.target.value)}>{suppliers.map((s)=><option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}</select></label>
                  <label><span>Поиск внутри списка</span><input value={listSearch} onChange={(e)=>setListSearch(e.target.value)} placeholder="Название товара" /></label>
                  <label><span>Coverage дней у поставщика</span><div className="inline-actions"><input value={supplierCoverageInput} onChange={(e)=>setSupplierCoverageInput(e.target.value)} placeholder="14" /><button className="icon-btn" onClick={confirmSupplierCoverage}>✎</button><button className="ghost-btn" onClick={()=>setSupplierCoverageInput('')}>Пропустить</button></div></label>
                </div>
              ) : (
                <div className="inline-grid">
                  <label><span>Поиск по товарам</span><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Введи название товара" /></label>
                  <label><span>Фильтр по поставщику</span><select value={searchSupplierFilter} onChange={(e)=>setSearchSupplierFilter(e.target.value)}><option value="">Все поставщики</option>{suppliers.map((s)=><option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}</select></label>
                </div>
              )}
            </section>

            {currentDraft.batch.draft_mode === 'single' && (
              <section className="card table-card"><div className="table-wrap"><table><thead><tr><th>Товар</th><th>Рекомендация</th><th>Остаток</th><th>Coverage</th><th>Добавить</th></tr></thead><tbody>
                {recommendations.filter((r)=>r.sku_name.toLowerCase().includes(listSearch.toLowerCase())).map((row)=><tr key={row.id}><td><div className="sku">{row.sku_name}</div></td><td>{row.to_order}</td><td>{row.available_qty}</td><td><div className="meta-row"><span>{row.coverage_days}</span><button className="icon-btn small" onClick={()=>confirmProductCoverage(row.norm_name,row.sku_name)}>✎</button></div><div className="inline-actions compact"><input value={productCoverageInputs[row.norm_name]||''} onChange={(e)=>setProductCoverageInputs((p)=>({...p,[row.norm_name]:e.target.value}))} placeholder="дни" /></div></td><td><button className="primary ghost" onClick={()=>addRecommendationToDraft(row)}>Добавить</button></td></tr>)}
              </tbody></table></div></section>
            )}

            {currentDraft.batch.draft_mode === 'multi' && (
              <section className="card search-card"><div className="search-results">{searchResults.map((row)=><div key={row.id} className="search-item"><div><strong>{row.sku_name}</strong><div className="meta">{row.supplier_name} · рекомендовано {row.to_order}</div></div><button className="primary ghost" onClick={()=>addRecommendationToDraft(row)}>Добавить</button></div>)}</div></section>
            )}

            <section className="card orders-card"><div className="section-head"><div><span className="eyebrow">Текущая заявка</span><h2>Добавленные товары</h2></div></div><div className="search-results">{filteredCurrentItems.map((item)=><div key={item.id} className="search-item"><div><strong>{item.sku_name}</strong><div className="meta">менеджер {item.manager_qty} · система {item.recommended_qty}</div></div><div className="inline-actions"><input type="number" value={item.manager_qty} onChange={(e)=>updateDraftItem(item,{manager_qty:Number(e.target.value)})} /><button className="danger-btn" onClick={()=>removeDraftItem(item.id)}>🗑</button></div></div>)}</div></section>
            <section className="card footer-actions"><button className="ghost-btn" onClick={()=>setTab('drafts')}>В драфты</button><button className="primary ghost" onClick={submitDraft}>Создать заявку</button></section>
          </>
        )}

        {tab === 'drafts' && (
          <section className="card orders-card"><div className="section-head"><div><span className="eyebrow">Драфты</span><h2>Незавершённые заявки</h2></div></div><div className="orders-grid">{drafts.map((d)=><article key={d.id} className="order-tile"><div><div className="status-badge">draft</div><h3>#{d.id} · {d.draft_mode}</h3><p>{d.items_count} позиций · {currency.format(d.total_qty||0)} шт</p><span className="meta">{new Date(d.created_at).toLocaleString('ru-RU')}</span></div><button className="primary ghost" onClick={()=>openDraft(d.id)}>Открыть</button></article>)}</div></section>
        )}

        {tab === 'orders' && (
          <section className="card orders-card"><div className="section-head"><div><span className="eyebrow">Заявки</span><h2>Созданные заявки</h2></div></div><div className="orders-grid">{orders.map((order)=><article key={order.id} className="order-tile"><div><div className="status-badge">{order.status}</div><h3>{order.supplier_name}</h3><p>{order.items_count} позиций · {currency.format(order.total_qty)}</p><span className="meta">{new Date(order.created_at).toLocaleString('ru-RU')}</span></div><div className="inline-actions"><button className="primary ghost" onClick={()=>openOrderDetail(order.id)}>Открыть</button><button className="primary ghost" disabled={order.status==='completed'} onClick={()=>fetchJSON(apiUrl(`/api/orders/${order.id}/complete`),{method:'POST'}).then(loadOrders)}>{order.status==='completed'?'Выполнена':'Выполнить'}</button></div></article>)}</div>
          {openOrder && <div className="card search-card"><div className="section-head"><div><span className="eyebrow">Состав заявки</span><h2>#{openOrder.batch.id} · {openOrder.batch.supplier_name}</h2></div></div><div className="search-results">{openOrder.items.map((item)=><div key={item.id} className="search-item"><div><strong>{item.sku_name}</strong><div className="meta">{item.final_qty} шт · причина: {item.reason || '—'}</div></div></div>)}</div></div>}
          </section>
        )}

        {tab === 'nonLiquid' && (
          <section className="card orders-card">
            <div className="section-head"><div><span className="eyebrow">Неликвиды</span><h2>Нет продаж за последние 4 месяца</h2></div></div>
            <div className="inline-grid">
              <label><span>Фильтр по группе</span><select value={nonLiquidGroup} onChange={(e)=>setNonLiquidGroup(e.target.value)}><option value="">Все группы</option>{nonLiquidGroups.map((g)=><option key={g} value={g}>{g}</option>)}</select></label>
              <label><span>Поиск по товару</span><input value={nonLiquidSearch} onChange={(e)=>setNonLiquidSearch(e.target.value)} placeholder="Название / артикул" /></label>
            </div>
            {nonLiquidLoading && <div className="loading-block"><div className="spinner" /><span>Загружаю неликвиды…</span></div>}
            <div className="table-scroll-hint"><div className="table-pan-x"><table><thead><tr><th>Группа</th><th>Товар</th><th>Остаток</th><th>Продажи 4 мес</th><th>Последняя продажа</th><th>Дней назад</th><th>Магазин</th></tr></thead><tbody>
              {nonLiquidItems.map((row, idx)=><tr key={`${row.norm_name}-${row.store_ref}-${idx}`}><td>{row.subgroup || 'Без группы'}</td><td><div className="sku">{row.sku_name}</div><div className="meta">{row.item_ref || '—'}</div></td><td>{currency.format(row.available_qty || 0)}</td><td>{currency.format(row.sales_qty_4m || 0)}</td><td>{row.last_sale_date ? new Date(row.last_sale_date).toLocaleDateString('ru-RU') : 'не было'}</td><td>{row.days_since_last_sale != null ? `${row.days_since_last_sale} дн.` : '—'}</td><td>{row.store}</td></tr>)}
            </tbody></table></div></div>
          </section>
        )}
      </main>
    </div>
  );
}
