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
type DraftLine = Recommendation & {manager_qty: number; reason: string; added_manually?: boolean};
type OrderBatch = {
  id: number;
  supplier_name: string;
  status: string;
  created_at: string;
  items_count: number;
  total_qty: number;
};

type CreateMode = 'single' | 'multi';
type CreateStep = 'choose-mode' | 'compose';
const currency = new Intl.NumberFormat('ru-RU');

export function App() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [draft, setDraft] = useState<Record<number, DraftLine>>({});
  const [orders, setOrders] = useState<OrderBatch[]>([]);
  const [tab, setTab] = useState<'create' | 'drafts' | 'orders'>('create');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<CreateMode>('single');
  const [createStep, setCreateStep] = useState<CreateStep>('choose-mode');
  const [listSearch, setListSearch] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Recommendation[]>([]);
  const [searchSupplierFilter, setSearchSupplierFilter] = useState('');
  const [supplierCoverageInput, setSupplierCoverageInput] = useState<string>('');
  const [productCoverageInputs, setProductCoverageInputs] = useState<Record<string, string>>({});
  const [justAddedIds, setJustAddedIds] = useState<number[]>([]);

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

  async function loadOrders() {
    setOrders(await fetchJSON<OrderBatch[]>(apiUrl('/api/orders')));
  }

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    loadSuppliers();
    loadOrders();
  }, []);

  useEffect(() => {
    const selected = suppliers.find((s) => s.supplier_name === selectedSupplier);
    setSupplierCoverageInput(selected?.coverage_days != null ? String(selected.coverage_days) : '');
  }, [suppliers, selectedSupplier]);

  useEffect(() => {
    if (!selectedSupplier || mode !== 'single') return;
    setLoading(true);
    fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`))
      .then((rows) => {
        setRecommendations(rows);
        setDraft((prev) => {
          const next = {...prev};
          rows.forEach((row) => {
            if (!next[row.id]) next[row.id] = {...row, manager_qty: row.to_order, reason: '', added_manually: false};
          });
          return next;
        });
        const coverageInputs: Record<string, string> = {};
        rows.forEach((row) => { coverageInputs[row.norm_name] = String(row.coverage_days ?? ''); });
        setProductCoverageInputs((prev) => ({...prev, ...coverageInputs}));
      })
      .finally(() => setLoading(false));
  }, [selectedSupplier, mode]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      fetchJSON<Recommendation[]>(apiUrl(`/api/search?q=${encodeURIComponent(q)}`)).then((rows) => {
        const filtered = searchSupplierFilter ? rows.filter((r) => r.supplier_name === searchSupplierFilter) : rows;
        setSearchResults(filtered);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [search, searchSupplierFilter]);

  const visibleDraftRows = useMemo(() => {
    const rows = Object.values(draft);
    if (mode === 'single') {
      return rows
        .filter((row) => row.supplier_name === selectedSupplier)
        .filter((row) => row.sku_name.toLowerCase().includes(listSearch.toLowerCase()));
    }
    return rows.filter((row) => row.sku_name.toLowerCase().includes(listSearch.toLowerCase()));
  }, [draft, selectedSupplier, listSearch, mode]);

  const summary = useMemo(() => {
    const rows = visibleDraftRows;
    return {
      items: rows.length,
      totalQty: rows.reduce((sum, row) => sum + Number(row.manager_qty || 0), 0),
      changed: rows.filter((row) => Number(row.manager_qty) !== Number(row.to_order)).length,
    };
  }, [visibleDraftRows]);

  function updateLine(id: number, patch: Partial<DraftLine>) {
    setDraft((prev) => ({...prev, [id]: {...prev[id], ...patch}}));
  }

  function addToDraft(row: Recommendation) {
    setDraft((prev) => ({...prev, [row.id]: prev[row.id] ?? {...row, manager_qty: row.to_order, reason: '', added_manually: true}}));
    setJustAddedIds((prev) => [row.id, ...prev.filter((id) => id !== row.id)].slice(0, 8));
    setTimeout(() => setJustAddedIds((prev) => prev.filter((id) => id !== row.id)), 3000);
    setCreateStep('compose');
    setTab('create');
    if (mode === 'single') setSelectedSupplier(row.supplier_name);
  }

  function removeFromDraft(id: number) {
    setDraft((prev) => {
      const next = {...prev};
      delete next[id];
      return next;
    });
  }

  async function confirmSupplierCoverage() {
    if (!selectedSupplier) return;
    const value = supplierCoverageInput.trim();
    const label = value ? `${value} дней` : 'пропустить';
    if (!confirm(`Подтвердить coverage для поставщика ${selectedSupplier}: ${label}?`)) return;
    await fetchJSON(apiUrl('/api/coverage/supplier'), {
      method: 'POST', body: JSON.stringify({supplier_name: selectedSupplier, coverage_days: value ? Number(value) : null})
    });
    await loadSuppliers();
  }

  async function confirmProductCoverage(row: DraftLine) {
    const value = (productCoverageInputs[row.norm_name] ?? '').trim();
    const label = value ? `${value} дней` : 'пропустить';
    if (!confirm(`Подтвердить coverage для товара "${row.sku_name}": ${label}?`)) return;
    await fetchJSON(apiUrl('/api/coverage/product'), {
      method: 'POST', body: JSON.stringify({norm_name: row.norm_name, coverage_days: value ? Number(value) : null})
    });
    updateLine(row.id, {coverage_days: value ? Number(value) : row.coverage_days, coverage_source: value ? 'product' : row.coverage_source});
  }

  async function createOrder() {
    const lines = visibleDraftRows.filter((row) => Number(row.manager_qty) > 0);
    const invalid = lines.find((row) => Number(row.manager_qty) !== Number(row.to_order) && !row.reason.trim());
    if (invalid) return alert('Если количество изменено, нужно написать объяснение.');
    const grouped = new Map<string, DraftLine[]>();
    for (const row of lines) {
      const key = row.supplier_name;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    for (const [supplier, items] of grouped) {
      await fetchJSON(apiUrl('/api/orders'), {
        method: 'POST',
        body: JSON.stringify({supplier_name: supplier, items: items.map((row) => ({recommendation_id: row.id, manager_qty: Number(row.manager_qty), reason: row.reason}))})
      });
    }
    await loadOrders();
    setTab('orders');
  }

  async function markDone(id: number) {
    await fetchJSON(apiUrl(`/api/orders/${id}/complete`), {method: 'POST'});
    await loadOrders();
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="eyebrow">Telegram Web App</span>
          <h1>Zakup Manager</h1>
          <p>Создание заявок по одному или нескольким поставщикам.</p>
        </div>
        <div className="panel">
          <button className={tab === 'create' ? 'tab active' : 'tab'} onClick={() => { setTab('create'); setCreateStep('choose-mode'); }}>Новая заявка</button>
          <button className={tab === 'drafts' ? 'tab active' : 'tab'} onClick={() => setTab('drafts')}>Список драфтов</button>
          <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>Список заявок</button>
        </div>
        <div className="panel stat-grid">
          <div><span>Поставщики</span><strong>{suppliers.length}</strong></div>
          <div><span>Позиций</span><strong>{summary.items}</strong></div>
          <div><span>Всего шт</span><strong>{currency.format(summary.totalQty)}</strong></div>
          <div><span>Изменено</span><strong>{summary.changed}</strong></div>
        </div>
      </aside>

      <main className="main">
        {tab === 'create' && (
          <>
            {createStep === 'choose-mode' && (
              <section className="hero card">
                <div>
                  <span className="eyebrow">Шаг 1</span>
                  <h2>Какая именно заявка?</h2>
                  <p>Сначала выбери тип заявки, а уже потом откроется меню составления.</p>
                </div>
                <div className="step-cards">
                  <button className="step-card" onClick={() => { setMode('single'); setCreateStep('compose'); }}>
                    <strong>Один поставщик</strong>
                    <span>Покажем товары конкретного поставщика и поиск внутри списка.</span>
                  </button>
                  <button className="step-card" onClick={() => { setMode('multi'); setCreateStep('compose'); }}>
                    <strong>Несколько поставщиков</strong>
                    <span>Откроем поиск по товарам + фильтр по поставщикам.</span>
                  </button>
                </div>
              </section>
            )}

            {createStep === 'compose' && mode === 'single' && (
              <>
                <section className="card search-card">
                  <div className="section-head"><div><span className="eyebrow">Шаг 2</span><h2>Составление заявки по одному поставщику</h2></div></div>
                  <div className="inline-grid">
                    <label>
                      <span>Поставщик</span>
                      <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
                        {suppliers.map((s) => <option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Поиск внутри списка</span>
                      <input value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Название товара" />
                    </label>
                    <label>
                      <span>Coverage дней у поставщика</span>
                      <div className="inline-actions">
                        <input value={supplierCoverageInput} onChange={(e) => setSupplierCoverageInput(e.target.value)} placeholder="14" />
                        <button className="icon-btn" onClick={confirmSupplierCoverage}>✎</button>
                        <button className="ghost-btn" onClick={() => setSupplierCoverageInput('')}>Пропустить</button>
                      </div>
                    </label>
                  </div>
                </section>
                <section className="card table-card">
                  {loading ? <p>Загружаю…</p> : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr><th>Товар</th><th>Система</th><th>Менеджер</th><th>Остаток</th><th>Coverage</th><th>Действия</th><th>Причина</th></tr>
                        </thead>
                        <tbody>
                          {visibleDraftRows.map((row) => (
                            <tr key={row.id}>
                              <td><div className="sku">{row.sku_name}</div><div className="meta">{row.demand_mode}</div></td>
                              <td><strong>{row.to_order}</strong><div className="meta">реком. {row.recommended_stock}</div></td>
                              <td><input type="number" min={0} value={row.manager_qty} onChange={(e) => updateLine(row.id, {manager_qty: Number(e.target.value)})} /></td>
                              <td>{row.available_qty}</td>
                              <td>
                                <div className="meta-row"><span>{row.coverage_days} дн</span><button className="icon-btn small" onClick={() => confirmProductCoverage(row)}>✎</button></div>
                                <div className="inline-actions compact">
                                  <input value={productCoverageInputs[row.norm_name] ?? ''} onChange={(e) => setProductCoverageInputs((prev) => ({...prev, [row.norm_name]: e.target.value}))} placeholder="дни" />
                                  <button className="ghost-btn small" onClick={() => setProductCoverageInputs((prev) => ({...prev, [row.norm_name]: ''}))}>Пропустить</button>
                                </div>
                              </td>
                              <td><button className="danger-btn" onClick={() => removeFromDraft(row.id)}>🗑</button></td>
                              <td><textarea value={row.reason} onChange={(e) => updateLine(row.id, {reason: e.target.value})} placeholder="если меняешь количество" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}

            {createStep === 'compose' && mode === 'multi' && (
              <section className="card search-card">
                <div className="section-head"><div><span className="eyebrow">Шаг 2</span><h2>Составление мультизаявки</h2></div></div>
                <div className="inline-grid">
                  <label>
                    <span>Поиск по товарам</span>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Введи название товара" />
                  </label>
                  <label>
                    <span>Фильтр по поставщику</span>
                    <select value={searchSupplierFilter} onChange={(e) => setSearchSupplierFilter(e.target.value)}>
                      <option value="">Все поставщики</option>
                      {suppliers.map((s) => <option key={s.supplier_name} value={s.supplier_name}>{s.supplier_name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="search-results">
                  {searchResults.map((row) => (
                    <div key={row.id} className={justAddedIds.includes(row.id) ? 'search-item added' : 'search-item'}>
                      <div>
                        <strong>{row.sku_name}</strong>
                        <div className="meta">{row.supplier_name} · рекомендовано {row.to_order} шт · остаток {row.available_qty}</div>
                      </div>
                      <button className="primary ghost" onClick={() => addToDraft(row)}>{justAddedIds.includes(row.id) ? 'Добавлено' : 'Добавить'}</button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {createStep === 'compose' && (
              <section className="card orders-card">
                <div className="section-head"><div><span className="eyebrow">Текущий состав</span><h2>Добавленные в заявку товары</h2></div></div>
                <div className="search-results">
                  {Object.values(draft).filter((row) => mode === 'multi' || row.supplier_name === selectedSupplier).map((row) => (
                    <div key={row.id} className="search-item">
                      <div>
                        <strong>{row.sku_name}</strong>
                        <div className="meta">{row.supplier_name} · менеджер {row.manager_qty} · система {row.to_order}</div>
                      </div>
                      <button className="danger-btn" onClick={() => removeFromDraft(row.id)}>🗑</button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="card footer-actions">
              {createStep !== 'choose-mode' && <button className="ghost-btn" onClick={() => setCreateStep('choose-mode')}>Назад к выбору типа</button>}
              {createStep === 'compose' && <button className="primary ghost" onClick={createOrder}>Создать заявку</button>}
            </section>
          </>
        )}

        {tab === 'drafts' && (
          <section className="card orders-card">
            <div className="section-head"><div><span className="eyebrow">Драфты</span><h2>Незавершённые заявки</h2></div></div>
            <div className="search-results">
              {Object.values(draft).map((row) => (
                <div key={row.id} className="search-item">
                  <div>
                    <strong>{row.sku_name}</strong>
                    <div className="meta">{row.supplier_name} · менеджер {row.manager_qty} · система {row.to_order}</div>
                  </div>
                  <button className="danger-btn" onClick={() => removeFromDraft(row.id)}>🗑</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'orders' && (
          <section className="card orders-card">
            <div className="section-head"><div><span className="eyebrow">Заявки</span><h2>Созданные и выполненные</h2></div></div>
            <div className="orders-grid">
              {orders.map((order) => (
                <article key={order.id} className="order-tile">
                  <div>
                    <div className="status-badge">{order.status}</div>
                    <h3>{order.supplier_name}</h3>
                    <p>{order.items_count} позиций · {currency.format(order.total_qty)} шт</p>
                    <span className="meta">{new Date(order.created_at).toLocaleString('ru-RU')}</span>
                  </div>
                  <button className="primary ghost" disabled={order.status === 'completed'} onClick={() => markDone(order.id)}>
                    {order.status === 'completed' ? 'Выполнена' : 'Выполнить заявку'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
