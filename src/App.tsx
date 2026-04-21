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
type DraftLine = Recommendation & {manager_qty: number; reason: string};
type OrderBatch = {
  id: number;
  supplier_name: string;
  status: string;
  created_at: string;
  items_count: number;
  total_qty: number;
};

const currency = new Intl.NumberFormat('ru-RU');

export function App() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [draft, setDraft] = useState<Record<number, DraftLine>>({});
  const [orders, setOrders] = useState<OrderBatch[]>([]);
  const [tab, setTab] = useState<'create' | 'orders'>('create');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Recommendation[]>([]);
  const [supplierCoverageInput, setSupplierCoverageInput] = useState<string>('');
  const [productCoverageInputs, setProductCoverageInputs] = useState<Record<string, string>>({});

  async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      headers: {'Content-Type': 'application/json'},
      ...options,
    });
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
    if (!selectedSupplier) return;
    setLoading(true);
    fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`))
      .then((rows) => {
        setRecommendations(rows);
        const next: Record<number, DraftLine> = {};
        const coverageInputs: Record<string, string> = {};
        rows.forEach((row) => {
          next[row.id] = {...row, manager_qty: row.to_order, reason: ''};
          coverageInputs[row.norm_name] = String(row.coverage_days ?? '');
        });
        setDraft(next);
        setProductCoverageInputs(coverageInputs);
      })
      .finally(() => setLoading(false));
  }, [selectedSupplier]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetchJSON<Recommendation[]>(apiUrl(`/api/search?q=${encodeURIComponent(q)}`)).then(setSearchResults);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const summary = useMemo(() => {
    const rows = Object.values(draft);
    return {
      items: rows.length,
      totalQty: rows.reduce((sum, row) => sum + Number(row.manager_qty || 0), 0),
      changed: rows.filter((row) => Number(row.manager_qty) !== Number(row.to_order)).length,
    };
  }, [draft]);

  function updateLine(id: number, patch: Partial<DraftLine>) {
    setDraft((prev) => ({...prev, [id]: {...prev[id], ...patch}}));
  }

  function addToDraft(row: Recommendation) {
    setSelectedSupplier(row.supplier_name);
    setDraft((prev) => ({
      ...prev,
      [row.id]: prev[row.id] ?? {...row, manager_qty: row.to_order, reason: ''}
    }));
  }

  async function confirmSupplierCoverage() {
    if (!selectedSupplier) return;
    const value = supplierCoverageInput.trim();
    const label = value ? `${value} дней` : 'пропуск / null';
    if (!confirm(`Подтвердить coverage для поставщика ${selectedSupplier}: ${label}?`)) return;
    await fetchJSON(apiUrl('/api/coverage/supplier'), {
      method: 'POST',
      body: JSON.stringify({supplier_name: selectedSupplier, coverage_days: value ? Number(value) : null})
    });
    await loadSuppliers();
    const rows = await fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`));
    setRecommendations(rows);
    const next: Record<number, DraftLine> = {};
    rows.forEach((row) => {
      const existing = draft[row.id];
      next[row.id] = existing ? {...existing, coverage_days: row.coverage_days, coverage_source: row.coverage_source} : {...row, manager_qty: row.to_order, reason: ''};
    });
    setDraft(next);
  }

  async function confirmProductCoverage(row: Recommendation) {
    const value = (productCoverageInputs[row.norm_name] ?? '').trim();
    const label = value ? `${value} дней` : 'пропуск / null';
    if (!confirm(`Подтвердить coverage для товара "${row.sku_name}": ${label}?`)) return;
    await fetchJSON(apiUrl('/api/coverage/product'), {
      method: 'POST',
      body: JSON.stringify({norm_name: row.norm_name, coverage_days: value ? Number(value) : null})
    });
    const rows = await fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`));
    setRecommendations(rows);
    const next: Record<number, DraftLine> = {};
    const coverageInputs: Record<string, string> = {};
    rows.forEach((item) => {
      const existing = draft[item.id];
      next[item.id] = existing ? {...existing, coverage_days: item.coverage_days, coverage_source: item.coverage_source, to_order: item.to_order, recommended_stock: item.recommended_stock} : {...item, manager_qty: item.to_order, reason: ''};
      coverageInputs[item.norm_name] = String(item.coverage_days ?? '');
    });
    setDraft(next);
    setProductCoverageInputs(coverageInputs);
  }

  async function createOrder() {
    const lines = Object.values(draft).filter((row) => Number(row.manager_qty) > 0);
    const invalid = lines.find((row) => Number(row.manager_qty) !== Number(row.to_order) && !row.reason.trim());
    if (invalid) {
      alert('Если количество изменено, нужно написать объяснение.');
      return;
    }
    const payload = {supplier_name: selectedSupplier, items: lines.map((row) => ({
      recommendation_id: row.id,
      manager_qty: Number(row.manager_qty),
      reason: row.reason,
    }))};
    await fetchJSON(apiUrl('/api/orders'), {method: 'POST', body: JSON.stringify(payload)});
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
          <p>Панель менеджера для ручной сборки заявок по поставщикам.</p>
        </div>
        <div className="panel">
          <button className={tab === 'create' ? 'tab active' : 'tab'} onClick={() => setTab('create')}>Создать заявку</button>
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
        {tab === 'create' ? (
          <>
            <section className="hero card">
              <div>
                <span className="eyebrow">Режим создания</span>
                <h2>Собери заявку по поставщику</h2>
                <p>Менеджер может искать товар, вручную добавлять его в заявку и менять покрытие в днях с подтверждением.</p>
              </div>
              <div className="hero-controls hero-stack">
                <label>
                  <span>Поставщик</span>
                  <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
                    {suppliers.map((s) => (
                      <option key={s.supplier_name} value={s.supplier_name}>
                        {s.supplier_name} · {currency.format(s.total_to_order)} шт
                      </option>
                    ))}
                  </select>
                </label>
                <div className="inline-block">
                  <label>
                    <span>Coverage дней у поставщика</span>
                    <input placeholder="например 14" value={supplierCoverageInput} onChange={(e) => setSupplierCoverageInput(e.target.value)} />
                  </label>
                  <div className="mini-actions">
                    <button className="primary ghost" onClick={confirmSupplierCoverage}>Подтвердить</button>
                    <button className="ghost-btn" onClick={() => setSupplierCoverageInput('')}>Пропустить</button>
                  </div>
                </div>
                <button className="primary" onClick={createOrder}>Создать заявку</button>
              </div>
            </section>

            <section className="card search-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Ручное добавление</span>
                  <h2>Поиск товара</h2>
                </div>
              </div>
              <input className="search-input" placeholder="Введи часть названия товара" value={search} onChange={(e) => setSearch(e.target.value)} />
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((row) => (
                    <div key={row.id} className="search-item">
                      <div>
                        <strong>{row.sku_name}</strong>
                        <div className="meta">{row.supplier_name} · рекомендовано {row.to_order} · остаток {row.available_qty}</div>
                      </div>
                      <button className="primary ghost" onClick={() => addToDraft(row)}>Добавить</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card table-card">
              {loading ? <p>Загружаю рекомендации…</p> : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Товар</th>
                        <th>Система</th>
                        <th>Менеджер</th>
                        <th>Остаток</th>
                        <th>Coverage</th>
                        <th>Причина изменения</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(draft).filter((row) => row.supplier_name === selectedSupplier).map((row) => (
                        <tr key={row.id}>
                          <td>
                            <div className="sku">{row.sku_name}</div>
                            <div className="meta">{row.item_ref || row.norm_name} · {row.demand_mode}</div>
                          </td>
                          <td>
                            <strong>{row.to_order}</strong>
                            <div className="meta">цель {row.recommended_stock}</div>
                          </td>
                          <td>
                            <input type="number" min={0} value={draft[row.id]?.manager_qty ?? row.to_order}
                              onChange={(e) => updateLine(row.id, {manager_qty: Number(e.target.value)})} />
                          </td>
                          <td>{row.available_qty}</td>
                          <td>
                            <div className="coverage-box">
                              <strong>{row.coverage_days}</strong>
                              <div className="meta">{row.coverage_source}</div>
                              <input
                                placeholder="дни"
                                value={productCoverageInputs[row.norm_name] ?? ''}
                                onChange={(e) => setProductCoverageInputs((prev) => ({...prev, [row.norm_name]: e.target.value}))}
                              />
                              <div className="mini-actions">
                                <button className="primary ghost small" onClick={() => confirmProductCoverage(row)}>Подтвердить</button>
                                <button className="ghost-btn small" onClick={() => setProductCoverageInputs((prev) => ({...prev, [row.norm_name]: ''}))}>Пропустить</button>
                              </div>
                            </div>
                          </td>
                          <td>
                            <textarea
                              placeholder="Обязательно, если количество изменено"
                              value={draft[row.id]?.reason ?? ''}
                              onChange={(e) => updateLine(row.id, {reason: e.target.value})}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="card orders-card">
            <div className="section-head">
              <div>
                <span className="eyebrow">Заявки</span>
                <h2>Созданные и выполненные</h2>
              </div>
            </div>
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
