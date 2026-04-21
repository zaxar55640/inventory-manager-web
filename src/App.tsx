import {useEffect, useMemo, useState} from 'react';
import {apiUrl} from './config';

type Supplier = {supplier_name: string; items_count: number; total_to_order: number};
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

  async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      headers: {'Content-Type': 'application/json'},
      ...options,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    fetchJSON<Supplier[]>(apiUrl('/api/suppliers')).then((data) => {
      setSuppliers(data);
      if (data[0]) setSelectedSupplier(data[0].supplier_name);
    });
    fetchJSON<OrderBatch[]>(apiUrl('/api/orders')).then(setOrders);
  }, []);

  useEffect(() => {
    if (!selectedSupplier) return;
    setLoading(true);
    fetchJSON<Recommendation[]>(apiUrl(`/api/recommendations?supplier=${encodeURIComponent(selectedSupplier)}`))
      .then((rows) => {
        setRecommendations(rows);
        const next: Record<number, DraftLine> = {};
        rows.forEach((row) => {
          next[row.id] = { ...row, manager_qty: row.to_order, reason: '' };
        });
        setDraft(next);
      })
      .finally(() => setLoading(false));
  }, [selectedSupplier]);

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
    setOrders(await fetchJSON<OrderBatch[]>(apiUrl('/api/orders')));
    setTab('orders');
  }

  async function markDone(id: number) {
    await fetchJSON(apiUrl(`/api/orders/${id}/complete`), {method: 'POST'});
    setOrders(await fetchJSON<OrderBatch[]>(apiUrl('/api/orders')));
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
                <p>Менеджер меняет количество, объясняет отклонения и формирует финальную заявку.</p>
              </div>
              <div className="hero-controls">
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
                <button className="primary" onClick={createOrder}>Создать заявку</button>
              </div>
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
                        <th>Покрытие</th>
                        <th>Причина изменения</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendations.map((row) => {
                        const line = draft[row.id];
                        return (
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
                              <input type="number" min={0} value={line?.manager_qty ?? row.to_order}
                                onChange={(e) => updateLine(row.id, {manager_qty: Number(e.target.value)})} />
                            </td>
                            <td>{row.available_qty}</td>
                            <td>
                              <strong>{row.coverage_days}</strong>
                              <div className="meta">{row.coverage_source}</div>
                            </td>
                            <td>
                              <textarea
                                placeholder="Обязательно, если количество изменено"
                                value={line?.reason ?? ''}
                                onChange={(e) => updateLine(row.id, {reason: e.target.value})}
                              />
                            </td>
                          </tr>
                        );
                      })}
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
