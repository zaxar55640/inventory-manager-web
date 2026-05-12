import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.INVENTORY_DB || path.resolve(__dirname, '../inventory_mvp/db/inventory_mvp.sqlite');
const corsOrigin = process.env.CORS_ORIGIN || '*';
const db = new Database(dbPath);
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cs_item_code_date ON catalog_sales(item_code, sale_date);
    CREATE INDEX IF NOT EXISTS idx_cp_item_code ON catalog_products(item_code);
  `);
} catch (_e) { /* tables may not exist yet */ }
try { stmt('ALTER TABLE catalog_products ADD COLUMN article TEXT').run(); } catch (_e) {}
try { stmt('ALTER TABLE catalog_products ADD COLUMN supplier_name TEXT').run(); } catch (_e) {}

// Register JS toLowerCase so SQLite can do case-insensitive Cyrillic search
db.function('jslower', (s) => (s == null ? null : String(s).toLowerCase()));

// Prepared-statement cache - avoids re-compiling identical SQL on every request (~20ms each)
const _stmtCache = new Map();
const stmt = (sql) => {
  if (!_stmtCache.has(sql)) _stmtCache.set(sql, db.prepare(sql));
  return _stmtCache.get(sql);
};

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

app.get('/api/catalog2/item/:code/receipts', (req, res) => {
  const code = String(req.params.code || '').trim();
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  if (!code) return res.json({rows: [], summary: null});
  try {
    const rows = stmt(`
      SELECT
        receipt_date,
        receipt_number,
        supplier_name,
        article,
        qty AS receipt_qty,
        price,
        amount AS sum
      FROM catalog_receipts
      WHERE item_code = ?
      ORDER BY date(receipt_date) DESC, id DESC
      LIMIT ?
    `).all(code, limit);

    const summary = stmt(`
      SELECT
        COUNT(*) AS receipts_count,
        ROUND(SUM(COALESCE(qty, 0)), 2) AS total_qty,
        ROUND(AVG(NULLIF(price, 0)), 2) AS avg_price,
        MAX(date(receipt_date)) AS last_receipt_date,
        MAX(CASE WHEN date(receipt_date) = (
          SELECT MAX(date(receipt_date)) FROM catalog_receipts WHERE item_code = ?
        ) THEN price END) AS last_price
      FROM catalog_receipts
      WHERE item_code = ?
    `).get(code, code);

    res.json({rows, summary});
  } catch (e) {
    res.status(500).json({error: String(e?.message || e)});
  }
});

try {
  db.exec(`
    ALTER TABLE purchase_order_batches ADD COLUMN draft_mode TEXT;
    ALTER TABLE purchase_order_batches ADD COLUMN is_draft INTEGER DEFAULT 0;
  `);
} catch {}
try {
  db.exec(`ALTER TABLE purchase_order_items ADD COLUMN reason TEXT;`);
} catch {}
try { db.exec(`ALTER TABLE purchase_order_batches ADD COLUMN batch_name TEXT;`); } catch {}
try { db.exec(`ALTER TABLE purchase_order_batches ADD COLUMN manager_name TEXT;`); } catch {}
try { db.exec(`ALTER TABLE purchase_order_batches ADD COLUMN started_at TEXT;`); } catch {}
try { db.exec(`ALTER TABLE purchase_order_batches ADD COLUMN submitted_at TEXT;`); } catch {}
try { db.exec(`ALTER TABLE purchase_order_batches ADD COLUMN completed_at TEXT;`); } catch {}
try { db.exec(`ALTER TABLE purchase_order_batches ADD COLUMN canceled_at TEXT;`); } catch {}
try { db.exec(`ALTER TABLE purchase_order_items ADD COLUMN supplier_name TEXT;`); } catch {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_order_managers_name ON order_managers(name);
  `);
} catch {}

stmt("UPDATE purchase_order_batches SET is_draft = 0 WHERE status IN ('completed', 'submitted', 'in_delivery', 'cancelled')").run();

app.get('/api/suppliers', (_req, res) => {
  const rows = stmt(`
    SELECT r.supplier_name,
           COUNT(*) AS items_count,
           ROUND(SUM(r.to_order), 2) AS total_to_order,
           MAX(r.coverage_days) AS coverage_days,
           COALESCE(s.lead_time_days, 7)   AS lead_time_days,
           COALESCE(s.order_cycle_days, 7) AS order_cycle_days,
           s.moq_qty
    FROM purchase_recommendations r
    LEFT JOIN suppliers s ON s.supplier_name = r.supplier_name
    WHERE r.calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
      AND r.to_order > 0
    GROUP BY r.supplier_name
    ORDER BY total_to_order DESC
  `).all();
  res.json(rows);
});

app.patch('/api/suppliers/:name/settings', (req, res) => {
  const name = req.params.name;
  const {lead_time_days, order_cycle_days, moq_qty} = req.body;
  const sup = stmt('SELECT id FROM suppliers WHERE supplier_name = ?').get(name);
  if (!sup) return res.status(404).json({error: 'supplier not found'});
  if (lead_time_days != null)
    stmt('UPDATE suppliers SET lead_time_days = ? WHERE supplier_name = ?').run(Number(lead_time_days), name);
  if (order_cycle_days != null)
    stmt('UPDATE suppliers SET order_cycle_days = ? WHERE supplier_name = ?').run(Number(order_cycle_days), name);
  if (moq_qty != null)
    stmt('UPDATE suppliers SET moq_qty = ? WHERE supplier_name = ?').run(moq_qty === '' ? null : Number(moq_qty), name);
  res.json({ok: true});
});

// Two-level dedup: first per (store, sku_name) to collapse duplicate script runs,
// then aggregate across stores. This prevents inflated available_qty and to_order.
function prDedupSql(extraWhere) {
  return `
    SELECT MIN(id) AS id, sku_name,
           MAX(item_ref) AS item_ref, MAX(norm_name) AS norm_name,
           MAX(supplier_name) AS supplier_name,
           SUM(available_qty) AS available_qty, SUM(in_transit_qty) AS in_transit_qty,
           SUM(to_order) AS to_order, MAX(recommended_stock) AS recommended_stock,
           MAX(demand_mode) AS demand_mode, MAX(abc_class) AS abc_class,
           MAX(xyz_class) AS xyz_class, MAX(coverage_days) AS coverage_days,
           MAX(coverage_source) AS coverage_source, MAX(system_note) AS system_note,
           MAX(lead_time_days) AS lead_time_days, MAX(order_cycle_days) AS order_cycle_days,
           MAX(cycle_stock) AS cycle_stock, MAX(safety_stock) AS safety_stock,
           MAX(pre_season_flag) AS pre_season_flag, MAX(peak_months) AS peak_months,
           MAX(explain_text) AS explain_text, MIN(status_ranked) AS status_ranked
    FROM (
      SELECT MIN(id) AS id, sku_name, store,
             MAX(item_ref) AS item_ref, MAX(norm_name) AS norm_name,
             MAX(supplier_name) AS supplier_name,
             MAX(available_qty) AS available_qty, MAX(in_transit_qty) AS in_transit_qty,
             MAX(to_order) AS to_order, MAX(recommended_stock) AS recommended_stock,
             MAX(demand_mode) AS demand_mode, MAX(abc_class) AS abc_class,
             MAX(xyz_class) AS xyz_class, MAX(coverage_days) AS coverage_days,
             MAX(coverage_source) AS coverage_source, MAX(system_note) AS system_note,
             MAX(lead_time_days) AS lead_time_days, MAX(order_cycle_days) AS order_cycle_days,
             MAX(cycle_stock) AS cycle_stock, MAX(safety_stock) AS safety_stock,
             MAX(pre_season_flag) AS pre_season_flag, MAX(peak_months) AS peak_months,
             MAX(explain_text) AS explain_text,
             MIN(CASE status
               WHEN 'urgent_order'                 THEN '1_urgent_order'
               WHEN 'pre_season_order'             THEN '2_pre_season_order'
               WHEN 'order'                        THEN '3_order'
               WHEN 'limited_history_manual_check' THEN '4_limited_history_manual_check'
               WHEN 'new_item_manual_check'        THEN '5_new_item_manual_check'
               WHEN 'ok'                           THEN '6_ok'
               WHEN 'overstock_risk'               THEN '7_overstock_risk'
               ELSE '8_' || COALESCE(status,'')
             END) AS status_ranked
      FROM purchase_recommendations
      WHERE calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
        ${extraWhere ? 'AND ' + extraWhere : ''}
      GROUP BY sku_name, store
    )
    GROUP BY sku_name
  `;
}

const PR_SELECT = `
  SELECT r.id, r.supplier_name, r.sku_name, r.item_ref, r.norm_name,
         r.available_qty, r.in_transit_qty, r.to_order, r.recommended_stock,
         r.demand_mode, r.abc_class, r.xyz_class,
         r.coverage_days, r.coverage_source, r.system_note,
         r.lead_time_days, r.order_cycle_days,
         r.cycle_stock, r.safety_stock,
         r.pre_season_flag, r.peak_months, r.explain_text,
         SUBSTR(r.status_ranked, 3) AS status
  FROM (`;

app.get('/api/recommendations', (req, res) => {
  const supplier = String(req.query.supplier || '');
  const rows = stmt(`
    ${PR_SELECT}
      ${prDedupSql('supplier_name = ? AND to_order > 0')}
    ) r
    ORDER BY r.status_ranked ASC, r.to_order DESC, r.sku_name ASC
  `).all(supplier);
  res.json(rows);
});

app.get('/api/search', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  if (q === '%%') return res.json([]);
  const rows = stmt(`
    ${PR_SELECT}
      ${prDedupSql('(sku_name LIKE ? OR norm_name LIKE ? OR item_ref LIKE ?)')}
    ) r
    ORDER BY r.to_order DESC, r.sku_name ASC
    LIMIT 30
  `).all(q, q, q);
  res.json(rows);
});

app.get('/api/dashboard', (_req, res) => {
  const cached = stmt(`SELECT value FROM _analytics_cache WHERE key='dashboard'`).get();
  if (cached) return res.json(JSON.parse(cached.value));
  const stats = stmt(`
    SELECT
      COUNT(CASE WHEN status IN ('urgent_order','order','pre_season_order','limited_history_manual_check') AND to_order > 0 THEN 1 END) AS total_to_order,
      COUNT(CASE WHEN status = 'urgent_order'     THEN 1 END) AS urgent_count,
      COUNT(CASE WHEN status = 'pre_season_order' THEN 1 END) AS pre_season_count,
      COUNT(CASE WHEN status = 'overstock_risk'   THEN 1 END) AS overstock_count,
      COUNT(CASE WHEN status = 'new_item_manual_check' THEN 1 END) AS new_items_count
    FROM purchase_recommendations
    WHERE calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
  `).get();
  res.json(stats || {});
});

app.get('/api/decisions', (_req, res) => {
  const rows = stmt(`
    SELECT md.decision_date, md.manager_name, md.sku_name, md.system_qty, md.manager_qty,
           md.delta_qty, md.reason, md.supplier_name
    FROM manager_decisions md
    ORDER BY md.id DESC
    LIMIT 200
  `).all();
  res.json(rows);
});

app.get('/api/non-liquid/groups', (_req, res) => {
  const snapshotExists = stmt(`SELECT name FROM sqlite_master WHERE type='table' AND name='non_liquid_snapshot'`).get();
  if (snapshotExists) {
    const rows = stmt(`
      SELECT DISTINCT subgroup
      FROM non_liquid_snapshot
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM non_liquid_snapshot)
      ORDER BY subgroup ASC
    `).all();
    return res.json(rows.map((r) => r.subgroup || 'Без группы'));
  }
  try {
    db.exec(`ALTER TABLE stock_snapshots ADD COLUMN subgroup TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE stock_snapshots ADD COLUMN subgroup_ref TEXT`);
  } catch {}
  const rows = stmt(`
    SELECT DISTINCT COALESCE(NULLIF(subgroup, ''), NULLIF(subgroup_ref, ''), 'Без группы') AS subgroup
    FROM stock_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM stock_snapshots)
      AND COALESCE(available_qty, 0) > 0
    ORDER BY subgroup ASC
  `).all();
  res.json(rows.map((r) => r.subgroup));
});

function ensureNonLiquidColumns() {
  try {
    db.exec(`ALTER TABLE stock_snapshots ADD COLUMN subgroup TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE stock_snapshots ADD COLUMN subgroup_ref TEXT`);
  } catch {}
}

function buildNonLiquidBaseSql() {
  return `
    WITH latest_stock AS (
      SELECT
        s.store,
        s.store_ref,
        s.item_ref,
        s.sku_name,
        s.norm_name,
        COALESCE(NULLIF(s.subgroup, ''), NULLIF(s.subgroup_ref, ''), 'Без группы') AS subgroup,
        s.available_qty
      FROM stock_snapshots s
      WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM stock_snapshots)
        AND COALESCE(s.available_qty, 0) > 0
    ),
    sales_4m AS (
      SELECT norm_name, store_ref, SUM(COALESCE(sales_qty, 0)) AS sales_qty_4m
      FROM daily_sales
      WHERE date(sale_date) >= date('now', '-4 months')
      GROUP BY norm_name, store_ref
    ),
    sales_all AS (
      SELECT norm_name, store_ref, MAX(date(sale_date)) AS last_sale_date
      FROM daily_sales
      GROUP BY norm_name, store_ref
    )
    SELECT
      ls.store,
      ls.store_ref,
      ls.item_ref,
      ls.sku_name,
      ls.norm_name,
      ls.subgroup,
      ls.available_qty,
      COALESCE(s4.sales_qty_4m, 0) AS sales_qty_4m,
      sa.last_sale_date,
      CASE
        WHEN sa.last_sale_date IS NULL THEN NULL
        ELSE CAST(julianday('now') - julianday(sa.last_sale_date) AS INTEGER)
      END AS days_since_last_sale
    FROM latest_stock ls
    LEFT JOIN sales_4m s4 ON s4.norm_name = ls.norm_name AND s4.store_ref = ls.store_ref
    LEFT JOIN sales_all sa ON sa.norm_name = ls.norm_name AND sa.store_ref = ls.store_ref
    WHERE COALESCE(s4.sales_qty_4m, 0) <= 0
      AND (? = '' OR ls.subgroup = ?)
      AND (? = '' OR ls.sku_name LIKE ? OR ls.item_ref LIKE ? OR ls.norm_name LIKE ?)
  `;
}

app.get('/api/non-liquid', (req, res) => {
  const subgroup = String(req.query.subgroup || '').trim();
  const q = String(req.query.q || '').trim();
  const qLike = `%${q}%`;
  const snapshotExists = stmt(`SELECT name FROM sqlite_master WHERE type='table' AND name='non_liquid_snapshot'`).get();

  if (snapshotExists) {
    const rows = stmt(`
      SELECT store, store_ref, item_ref, sku_name, norm_name, subgroup, available_qty, sales_qty_4m,
             last_sale_date, days_since_last_sale, is_seasonal, season_note, nlq_score
      FROM non_liquid_snapshot
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM non_liquid_snapshot)
        AND (? = '' OR subgroup = ?)
        AND (? = '' OR sku_name LIKE ? OR item_ref LIKE ? OR norm_name LIKE ?)
      ORDER BY COALESCE(days_since_last_sale, 99999) DESC, available_qty DESC
    `).all(subgroup, subgroup, q, qLike, qLike, qLike);
    return res.json(rows);
  }

  ensureNonLiquidColumns();
  const baseSql = buildNonLiquidBaseSql();
  const params = [subgroup, subgroup, q, qLike, qLike, qLike];
  const rows = stmt(`
    ${baseSql}
    ORDER BY COALESCE(days_since_last_sale, 99999) DESC, available_qty DESC
  `).all(...params);
  res.json(rows);
});

app.get('/api/non-liquid-paged', (req, res) => {
  const subgroup = String(req.query.subgroup || '').trim();
  const q = String(req.query.q || '').trim();
  const qLike = `%${q}%`;
  const limitRaw = Number(req.query.limit || 200);
  const offsetRaw = Number(req.query.offset || 0);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
  const snapshotExists = stmt(`SELECT name FROM sqlite_master WHERE type='table' AND name='non_liquid_snapshot'`).get();

  if (snapshotExists) {
    const whereSql = `
      FROM non_liquid_snapshot
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM non_liquid_snapshot)
        AND (? = '' OR subgroup = ?)
        AND (? = '' OR sku_name LIKE ? OR item_ref LIKE ? OR norm_name LIKE ?)
    `;
    const params = [subgroup, subgroup, q, qLike, qLike, qLike];
    const total = stmt(`SELECT COUNT(*) AS total ${whereSql}`).get(...params).total;
    const rows = stmt(`
      SELECT store, store_ref, item_ref, sku_name, norm_name, subgroup, available_qty, sales_qty_4m,
             last_sale_date, days_since_last_sale, is_seasonal, season_note, nlq_score
      ${whereSql}
      ORDER BY COALESCE(days_since_last_sale, 99999) DESC, available_qty DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return res.json({items: rows, total, limit, offset, has_more: offset + rows.length < total});
  }

  ensureNonLiquidColumns();
  const baseSql = buildNonLiquidBaseSql();
  const params = [subgroup, subgroup, q, qLike, qLike, qLike];
  const total = stmt(`SELECT COUNT(*) AS total FROM (${baseSql})`).get(...params).total;
  const rows = stmt(`
    ${baseSql}
    ORDER BY COALESCE(days_since_last_sale, 99999) DESC, available_qty DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({items: rows, total, limit, offset, has_more: offset + rows.length < total});
});

app.post('/api/coverage/supplier', (req, res) => {
  const {supplier_name, coverage_days} = req.body;
  if (!supplier_name) return res.status(400).send('supplier_name required');
  stmt('UPDATE suppliers SET coverage_days = ? WHERE supplier_name = ?').run(coverage_days ?? null, supplier_name);
  res.json({ok: true});
});

app.post('/api/coverage/product', (req, res) => {
  const {norm_name, coverage_days} = req.body;
  if (!norm_name) return res.status(400).send('norm_name required');
  stmt('UPDATE products SET coverage_days = ? WHERE norm_name = ?').run(coverage_days ?? null, norm_name);
  res.json({ok: true});
});

app.get('/api/managers', (_req, res) => {
  const rows = stmt(`SELECT id, name FROM order_managers ORDER BY name COLLATE NOCASE ASC`).all();
  res.json(rows);
});

app.post('/api/managers', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({error: 'name required'});
  try {
    const result = stmt(`INSERT OR IGNORE INTO order_managers (name) VALUES (?)`).run(name);
    const row = stmt(`SELECT id, name FROM order_managers WHERE name = ?`).get(name);
    res.json({ok: true, created: !!result.changes, manager: row});
  } catch (e) {
    res.status(500).json({error: String(e?.message || e)});
  }
});

app.get('/api/drafts', (_req, res) => {
  const rows = stmt(`
    SELECT b.id, b.supplier_name, b.status, b.created_at, b.draft_mode,
           COALESCE(b.batch_name, b.supplier_name, '') AS batch_name,
           b.manager_name,
           COUNT(i.id) AS items_count,
           ROUND(SUM(COALESCE(i.final_qty, i.manager_qty, i.recommended_qty)), 2) AS total_qty
    FROM purchase_order_batches b
    LEFT JOIN purchase_order_items i ON i.batch_id = b.id
    WHERE b.is_draft = 1
    GROUP BY b.id
    ORDER BY b.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/drafts/latest', (_req, res) => {
  const row = stmt(`SELECT id, supplier_name, status, created_at, draft_mode, COALESCE(batch_name, '') AS batch_name, manager_name FROM purchase_order_batches WHERE is_draft = 1 ORDER BY id DESC LIMIT 1`).get();
  res.json(row || null);
});

app.post('/api/drafts', (req, res) => {
  const {draft_mode, batch_name, manager_name} = req.body;
  const result = stmt(`INSERT INTO purchase_order_batches (batch_date, supplier_name, batch_name, manager_name, status, draft_mode, is_draft) VALUES (date(), '', ?, ?, 'draft', ?, 1)`).run(batch_name || '', manager_name || '', draft_mode || 'single');
  res.json({id: result.lastInsertRowid});
});

app.get('/api/drafts/:id', (req, res) => {
  const batch = stmt(`SELECT id, supplier_name, status, created_at, draft_mode, COALESCE(batch_name,'') AS batch_name, manager_name, started_at, submitted_at, completed_at, canceled_at FROM purchase_order_batches WHERE id = ?`).get(req.params.id);
  const items = stmt(`SELECT id, recommendation_id, item_ref, sku_name, norm_name, recommended_qty, manager_qty, final_qty, reason, supplier_name FROM purchase_order_items WHERE batch_id = ? ORDER BY id DESC`).all(req.params.id);
  res.json({batch, items});
});

app.post('/api/drafts/:id/items', (req, res) => {
  const {item} = req.body;
  const rec = stmt(`SELECT id, item_ref, sku_name, norm_name, to_order FROM purchase_recommendations WHERE id = ?`).get(item.recommendation_id);
  if (!rec) return res.status(404).send('recommendation not found');
  const exists = stmt(`SELECT id FROM purchase_order_items WHERE batch_id = ? AND recommendation_id = ?`).get(req.params.id, item.recommendation_id);
  if (exists) return res.json({ok: true, existing: true});
  stmt(`UPDATE purchase_order_batches SET supplier_name = CASE WHEN supplier_name = '' THEN ? ELSE supplier_name END WHERE id = ?`).run(item.supplier_name || '', req.params.id);
  stmt(`INSERT INTO purchase_order_items (batch_id, recommendation_id, item_ref, sku_name, norm_name, recommended_qty, manager_qty, final_qty, item_status, reason, supplier_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
    .run(req.params.id, rec.id, rec.item_ref, rec.sku_name, rec.norm_name, rec.to_order, item.manager_qty ?? rec.to_order, item.manager_qty ?? rec.to_order, item.reason || '', item.supplier_name || '');
  res.json({ok: true});
});

app.post('/api/drafts/:id/items/:itemId', (req, res) => {
  const {manager_qty, reason} = req.body;
  stmt(`UPDATE purchase_order_items SET manager_qty = ?, final_qty = ?, reason = ? WHERE id = ? AND batch_id = ?`).run(manager_qty, manager_qty, reason || '', req.params.itemId, req.params.id);
  res.json({ok: true});
});

app.delete('/api/drafts/:id/items/:itemId', (req, res) => {
  stmt(`DELETE FROM purchase_order_items WHERE id = ? AND batch_id = ?`).run(req.params.itemId, req.params.id);
  res.json({ok: true});
});

// Add catalog item to draft (no recommendation_id required)
app.post('/api/drafts/:id/catalog-items', (req, res) => {
  const {item} = req.body;
  if (!item || !item.item_ref) return res.status(400).json({error: 'item_ref required'});
  const existing = stmt(`SELECT id FROM purchase_order_items WHERE batch_id = ? AND item_ref = ? AND recommendation_id IS NULL`).get(req.params.id, item.item_ref);
  if (existing) {
    stmt(`UPDATE purchase_order_items SET manager_qty = ?, final_qty = ? WHERE id = ?`).run(item.manager_qty || 1, item.manager_qty || 1, existing.id);
    return res.json({ok: true, existing: true, id: existing.id});
  }
  const result = stmt(`INSERT INTO purchase_order_items (batch_id, recommendation_id, item_ref, sku_name, norm_name, recommended_qty, manager_qty, final_qty, item_status, reason, supplier_name) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`) 
    .run(req.params.id, item.item_ref, item.sku_name || '', item.norm_name || '', item.recommended_qty || 0, item.manager_qty || 1, item.manager_qty || 1, item.reason || '', item.supplier_name || '');
  res.json({ok: true, id: result.lastInsertRowid});
});

// Ensure batch_name column exists
try { stmt('ALTER TABLE purchase_order_batches ADD COLUMN batch_name TEXT').run(); } catch {}

app.get('/api/orders', (_req, res) => {
  const rows = stmt(`
    SELECT b.id, COALESCE(b.batch_name, b.supplier_name, '') AS batch_name,
           b.supplier_name, b.status, b.created_at, b.manager_name,
           COUNT(i.id) AS items_count,
           ROUND(SUM(COALESCE(i.final_qty, i.manager_qty, i.recommended_qty)), 2) AS total_qty
    FROM purchase_order_batches b
    LEFT JOIN purchase_order_items i ON i.batch_id = b.id
    WHERE COALESCE(b.is_draft, 0) = 0
    GROUP BY b.id
    ORDER BY b.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/orders/:id', (req, res) => {
  const batch = stmt(`SELECT id, COALESCE(batch_name,'') AS batch_name, supplier_name, status, created_at, manager_name, started_at, submitted_at, completed_at, canceled_at FROM purchase_order_batches WHERE id = ?`).get(req.params.id);
  const items = stmt(`
    SELECT i.id, i.sku_name, i.item_ref, i.recommended_qty, i.manager_qty, i.final_qty, i.reason, i.item_status,
           COALESCE(i.supplier_name, r.supplier_name,
             (SELECT pr.supplier_name FROM purchase_recommendations pr
              WHERE pr.item_ref = i.item_ref LIMIT 1)
           ) AS supplier_name,
           (SELECT cp2.article FROM catalog_products cp2 WHERE cp2.item_code = i.item_ref LIMIT 1) AS article
    FROM purchase_order_items i
    LEFT JOIN purchase_recommendations r ON r.id = i.recommendation_id
    WHERE i.batch_id = ? ORDER BY i.id DESC
  `).all(req.params.id);
  res.json({batch, items});
});

app.post('/api/drafts/:id/start', (req, res) => {
  const batchId = req.params.id;
  const managerName = String(req.body?.manager_name || '').trim();
  if (!managerName) return res.status(400).json({error: 'manager_name required'});
  stmt(`INSERT OR IGNORE INTO order_managers (name) VALUES (?)`).run(managerName);
  stmt(`UPDATE purchase_order_batches SET manager_name = ?, status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?`).run(managerName, batchId);
  res.json({ok: true});
});

app.post('/api/drafts/:id/submit', (req, res) => {
  const batchId = req.params.id;
  const managerName = String(req.body?.manager_name || '').trim() || String(stmt(`SELECT COALESCE(manager_name, '') AS manager_name FROM purchase_order_batches WHERE id = ?`).get(batchId)?.manager_name || '').trim();
  if (!managerName) return res.status(400).json({error: 'manager_name required'});
  stmt(`INSERT OR IGNORE INTO order_managers (name) VALUES (?)`).run(managerName);
  const items = stmt(`SELECT i.*, r.supplier_name, r.store, r.item_ref AS rec_item_ref, r.sku_name AS rec_sku_name, r.norm_name, r.to_order
                            FROM purchase_order_items i
                            LEFT JOIN purchase_recommendations r ON r.id = i.recommendation_id
                            WHERE i.batch_id = ?`).all(batchId);
  for (const item of items) {
    const systemQty = item.recommended_qty || item.to_order || 0;
    const managerQty = item.manager_qty || 0;
    if (managerQty !== systemQty || (item.reason || '').trim()) {
      stmt(`INSERT INTO manager_decisions (decision_date, recommendation_id, supplier_name, store, item_ref, sku_name, norm_name, system_qty, manager_qty, delta_qty, reason, manager_name)
                  VALUES (date(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.recommendation_id, item.supplier_name || '', item.store || '', item.rec_item_ref || item.item_ref || '', item.rec_sku_name || item.sku_name, item.norm_name || '', systemQty, managerQty, managerQty - systemQty, item.reason || '', managerName);
    }
  }
  stmt(`UPDATE purchase_order_batches
        SET is_draft = 0,
            manager_name = ?,
            supplier_name = COALESCE(NULLIF(supplier_name,''), 'multi-supplier'),
            status = 'in_delivery',
            submitted_at = CURRENT_TIMESTAMP
        WHERE id = ?`).run(managerName, batchId);
  stmt(`UPDATE purchase_order_items SET item_status = 'in_delivery' WHERE batch_id = ?`).run(batchId);
  res.json({ok: true});
});

app.post('/api/orders/:id/cancel', (req, res) => {
  stmt("UPDATE purchase_order_batches SET status = 'cancelled', canceled_at = CURRENT_TIMESTAMP, is_draft = 0 WHERE id = ?").run(req.params.id);
  stmt("UPDATE purchase_order_items SET item_status = 'cancelled' WHERE batch_id = ?").run(req.params.id);
  res.json({ok: true});
});

app.post('/api/orders/:id/complete', (req, res) => {
  stmt("UPDATE purchase_order_batches SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  stmt("UPDATE purchase_order_items SET item_status = 'completed' WHERE batch_id = ?").run(req.params.id);
  res.json({ok: true});
});

// ── products catalog ───────────────────────────────────────────────────────────

app.get('/api/products-catalog', (req, res) => {
  const q      = String(req.query.q      || '').trim();
  const subgrp = String(req.query.subgroup  || '').trim();
  const supp   = String(req.query.supplier  || '').trim();
  const sortBy = String(req.query.sort_by   || 'sku_name');
  const sortDir= req.query.sort_dir === 'desc' ? 'DESC' : 'ASC';
  const limit  = Math.min(200, Math.max(1, Number(req.query.limit  || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  const allowed = new Set(['sku_name','subgroup','supplier_name','abc_class','xyz_class',
    'available_qty','to_order','status','last_sale_date','days_since_last_sale',
    'is_seasonal','nlq_score','peak_months']);
  const col = allowed.has(sortBy) ? sortBy : 'r.sku_name';
  const colPfx = ['last_sale_date','days_since_last_sale','is_seasonal','nlq_score'].includes(sortBy)
    ? `nl.${sortBy}`
    : sortBy === 'subgroup' ? `ss.subgroup`
    : sortBy === 'status' ? `r.status_ranked`
    : ['available_qty','supplier_name','to_order','abc_class','xyz_class','pre_season_flag','peak_months','sku_name'].includes(sortBy)
    ? `r.${sortBy}`
    : `r.sku_name`;

  const whereClauses = [];
  const params = [];

  if (q) {
    whereClauses.push(`(r.sku_name LIKE ? OR p.barcode = ? OR p.barcode LIKE ?)`);
    params.push(`%${q}%`, q, `%${q}%`);
  }
  if (subgrp) { whereClauses.push(`ss.subgroup = ?`); params.push(subgrp); }
  if (supp)   { whereClauses.push(`r.supplier_name = ?`); params.push(supp); }

  const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Two-level dedup: collapse duplicate script runs per (store, sku_name), then sum across stores
  const baseSql = `
    FROM (${prDedupSql('')}) r
    LEFT JOIN products p ON p.sku_name = r.sku_name
    LEFT JOIN (
      SELECT sku_name,
             COALESCE(MAX(NULLIF(subgroup,'')), MAX(NULLIF(subgroup_ref,'')), 'Без группы') AS subgroup
      FROM stock_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM stock_snapshots)
      GROUP BY sku_name
    ) ss ON ss.sku_name = r.sku_name
    LEFT JOIN (
      SELECT sku_name,
             MAX(last_sale_date) AS last_sale_date,
             CAST(julianday('now') - julianday(MAX(last_sale_date)) AS INTEGER) AS days_since_last_sale,
             MAX(is_seasonal) AS is_seasonal,
             MAX(season_note) AS season_note,
             MAX(nlq_score) AS nlq_score
      FROM non_liquid_snapshot
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM non_liquid_snapshot)
      GROUP BY sku_name
    ) nl ON nl.sku_name = r.sku_name
    LEFT JOIN (
      SELECT poi.item_ref, ROUND(SUM(COALESCE(poi.final_qty, poi.manager_qty, 0)), 2) AS in_delivery_qty
      FROM purchase_order_items poi
      JOIN purchase_order_batches pob ON pob.id = poi.batch_id
      WHERE pob.status = 'in_delivery'
      GROUP BY poi.item_ref
    ) od ON od.item_ref = r.item_ref
    ${where}
  `;

  try {
    const total = stmt(`SELECT COUNT(*) AS total ${baseSql}`).get(...params).total;
    const rows  = stmt(`
      SELECT r.sku_name, r.item_ref, p.barcode,
             ss.subgroup,
             r.available_qty,
             COALESCE(od.in_delivery_qty, 0) AS in_delivery_qty,
             r.supplier_name,
             r.to_order,
             SUBSTR(r.status_ranked, 3) AS status,
             r.pre_season_flag, r.peak_months,
             r.abc_class, r.xyz_class, r.explain_text,
             nl.last_sale_date, nl.days_since_last_sale,
             nl.is_seasonal, nl.season_note, nl.nlq_score
      ${baseSql}
      ORDER BY ${colPfx} ${sortDir} NULLS LAST
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    res.json({ items: rows, total, limit, offset, has_more: offset + rows.length < total });
  } catch (err) {
    console.error('/api/products-catalog error', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products-catalog/groups', (_req, res) => {
  try {
    const rows = stmt(`
      SELECT DISTINCT COALESCE(NULLIF(subgroup,''), NULLIF(subgroup_ref,''), 'Без группы') AS subgroup
      FROM stock_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM stock_snapshots)
      ORDER BY subgroup ASC
    `).all();
    res.json(rows.map(r => r.subgroup));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── catalog2: new product catalog from ping JSON ──────────────────────────────

// Build WHERE clause for a given path array (group_l0, group_l1, ...)
function catalogPathWhere(pathParts) {
  if (!pathParts.length) return { where: '', params: [] };
  const clauses = pathParts.map((_, i) => `group_l${i} = ?`);
  const base = clauses.join(' AND ');
  // For single-segment paths also match parent_name (covers items without group hierarchy)
  if (pathParts.length === 1) {
    return { where: `(${base} OR parent_name = ?)`, params: [...pathParts, pathParts[0]] };
  }
  return { where: base, params: pathParts };
}

// Returns immediate child group names + item count for each, at the given path depth
app.get('/api/catalog2/children', (req, res) => {
  try {
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];
    const depth = pathParts.length;
    const childCol = `group_l${depth}`;
    if (depth > 8) return res.json({ children: [], direct_items: 0 });

    const { where: pw, params: pp } = catalogPathWhere(pathParts);
    const baseWhere = pw ? `${pw} AND ${childCol} IS NOT NULL` : `${childCol} IS NOT NULL`;

    const children = stmt(`
      SELECT ${childCol} AS name, COUNT(*) AS item_count
      FROM catalog_products
      WHERE ${baseWhere}
      GROUP BY ${childCol}
      ORDER BY ${childCol} ASC
    `).all(...pp);

    // Count direct items (leaves) exactly at this path depth
    const directWhere = pw ? `${pw} AND group_depth = ${depth}` : `group_depth = ${depth}`;
    const direct = stmt(`SELECT COUNT(*) AS cnt FROM catalog_products WHERE ${directWhere}`).get(...pp);

    res.json({ children, direct_items: direct?.cnt ?? 0 });
  } catch (err) {
    console.error('/api/catalog2/children', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Returns paginated products at a given path prefix (all descendants) or search query
app.get('/api/catalog2/items', (req, res) => {
  try {
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];
    const q       = String(req.query.q || '').trim();
    const limit   = Math.min(200, Math.max(1, Number(req.query.limit  || 50)));
    const offset  = Math.max(0, Number(req.query.offset || 0));
    const sortByRaw  = String(req.query.sort_by  || 'item_name').split(',');
    const sortDirRaw = String(req.query.sort_dir || 'asc').split(',');

    const allowedSort = new Set(['item_name','item_code','qty','retail_price','purchase_price','parent_name','last_sale_date','days_since_last_sale','abc_class','forecast_day_matrix','to_order','recommended_stock','delta']);
    const colSql = {
      'to_order':           'COALESCE(cf.to_order, 0)',
      'recommended_stock':  'COALESCE(cf.recommended_stock, 0)',
      'delta':              '(COALESCE(cf.recommended_stock, 0) - COALESCE(cp.qty, 0))',
    };
    const orderClauses = sortByRaw.map((col, i) => {
      if (!allowedSort.has(col)) return null;
      const dir = (sortDirRaw[i] || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      return `${colSql[col] || col} ${dir} NULLS LAST`;
    }).filter(Boolean);
    if (!orderClauses.length) orderClauses.push('item_name ASC NULLS LAST');

    const conditions = [];
    const params = [];

    if (pathParts.length) {
      const { where: pw, params: pp } = catalogPathWhere(pathParts);
      conditions.push(pw);
      params.push(...pp);
    }
    if (q) {
      const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (words.length === 1) {
        const pat = `%${words[0]}%`;
        conditions.push(`(jslower(cp.item_name) LIKE ? OR jslower(cp.item_code) LIKE ? OR jslower(cp.parent_name) LIKE ? OR cp.barcode = ?)`);
        params.push(pat, pat, pat, q);
      } else {
        // All words must appear in name OR parent_name; also try code
        const nameConds  = words.map(() => `jslower(cp.item_name) LIKE ?`).join(' AND ');
        const pnameConds = words.map(() => `jslower(cp.parent_name) LIKE ?`).join(' AND ');
        conditions.push(`((${nameConds}) OR (${pnameConds}) OR jslower(cp.item_code) LIKE ? OR cp.barcode = ?)`);
        params.push(...words.map(w => `%${w}%`), ...words.map(w => `%${w}%`), `%${words.join('%')}%`, q);
      }
    }
    if (req.query.has_stock === '1') {
      conditions.push('cp.qty > 0');
    }
    if (req.query.supplier) {
      conditions.push('cp.item_code IN (SELECT item_ref FROM purchase_recommendations WHERE supplier_name = ?)');
      params.push(String(req.query.supplier));
    }
    if (req.query.pre_season === '1') {
      const curM = new Date().getMonth() + 1;
      const upcoming = [1, 2, 3].map(d => ((curM - 1 + d) % 12) + 1);
      const peakLikes = upcoming.map(() => `cf.peak_months LIKE ?`).join(' OR ');
      conditions.push(`(${peakLikes})`);
      conditions.push(`CAST(COALESCE(cf.to_order, 0) AS INTEGER) > 0`);
      params.push(...upcoming.map(m => `%${m}%`));
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const needsCfJoin = req.query.pre_season === '1';
    const countJoins = needsCfJoin
      ? `LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code LEFT JOIN catalog_forecast cf ON cf.item_code = cp.item_code`
      : '';

    const total = stmt(`SELECT COUNT(*) AS cnt FROM catalog_products cp ${countJoins} ${where}`).get(...params).cnt;
    const items = stmt(`
      SELECT cp.id, cp.item_code, cp.item_name, cp.barcode, cp.article, cp.qty, cp.reserve,
             cp.retail_price, cp.purchase_price, cp.parent_name, cp.variant,
             cp.group_l0, cp.group_l1, cp.group_l2, cp.group_l3, cp.group_l4,
             cp.group_l5, cp.group_l6, cp.group_l7, cp.group_l8,
             cp.group_depth, cp.group_full_path,
             ls.last_sale_date,
             ls.days_since_last_sale,
             cf.abc_class, cf.xyz_class, cf.forecast_day_matrix, cf.to_order AS forecast_to_order,
             cf.demand_mode AS forecast_mode, cf.w_forecast_final,
             cf.oos_days_365, cf.oos_fraction,
             COALESCE(od.in_delivery_qty, 0) AS in_delivery_qty,
             COALESCE(od.active_order_count, 0) AS active_order_count,
             (SELECT pr.supplier_name FROM purchase_recommendations pr WHERE pr.item_ref = cp.item_code LIMIT 1) AS supplier_name
      FROM catalog_products cp
      LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code
      LEFT JOIN catalog_forecast cf ON cf.item_code = cp.item_code
      LEFT JOIN (
        SELECT poi.item_ref,
               ROUND(SUM(COALESCE(poi.final_qty, poi.manager_qty, 0)), 2) AS in_delivery_qty,
               COUNT(DISTINCT pob.id) AS active_order_count
        FROM purchase_order_items poi
        JOIN purchase_order_batches pob ON pob.id = poi.batch_id
        WHERE pob.status = 'in_delivery'
        GROUP BY poi.item_ref
      ) od ON od.item_ref = cp.item_code
      ${where}
      ORDER BY ${orderClauses.join(', ')}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ items, total, limit, offset, has_more: offset + items.length < total });
  } catch (err) {
    console.error('/api/catalog2/items', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Search group names across all hierarchy levels
app.get('/api/catalog2/suppliers', (_req, res) => {
  try {
    const rows = stmt(`
      SELECT DISTINCT pr.supplier_name
      FROM purchase_recommendations pr
      WHERE pr.supplier_name IS NOT NULL AND pr.supplier_name != '' AND pr.supplier_name != 'UNMAPPED_SUPPLIER'
        AND pr.calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
      ORDER BY pr.supplier_name
    `).all();
    res.json(rows.map(r => r.supplier_name));
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.get('/api/catalog2/search-groups', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const results = [];

    for (let level = 0; level <= 8 && results.length < 25; level++) {
      const col = `group_l${level}`;
      const selectCols = Array.from({length: level + 1}, (_, i) => `group_l${i}`).join(', ');
      const wordConds = words.map(() => `jslower(${col}) LIKE ?`).join(' AND ');
      const rows = stmt(`
        SELECT ${selectCols}, COUNT(*) AS item_count
        FROM catalog_products
        WHERE (${wordConds}) AND ${col} IS NOT NULL
        GROUP BY ${selectCols}
        ORDER BY item_count DESC
        LIMIT 6
      `).all(...words.map(w => `%${w}%`));

      for (const row of rows) {
        const pathParts = Array.from({length: level + 1}, (_, i) => row[`group_l${i}`]).filter(Boolean);
        results.push({ name: row[col], depth: level, item_count: row.item_count, path: pathParts.join(' / ') });
      }
    }

    results.sort((a, b) => b.item_count - a.item_count);
    res.json(results.slice(0, 20));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Full forecast matrix for a product
app.get('/api/catalog2/analytics', (req, res) => {
  try {
    const scope = String(req.query.scope || 'all');
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];
    const conditions = [];
    const params = [];

    if (pathParts.length) {
      const { where: pw, params: pp } = catalogPathWhere(pathParts);
      conditions.push(pw);
      params.push(...pp);
    }
    if (req.query.supplier) {
      conditions.push('cp.item_code IN (SELECT item_ref FROM purchase_recommendations WHERE supplier_name = ?)');
      params.push(String(req.query.supplier));
    }

    // Fast path: serve pre-computed cache for the default no-filter all-scope request
    if (!conditions.length && scope === 'all') {
      const cached = stmt(`SELECT value FROM _analytics_cache WHERE key='analytics_all'`).get();
      if (cached) {
        const data = JSON.parse(cached.value);
        const ov = data.overview;
        const segs = data.segments;
        ov.coverage_days = Number(ov.total_sales_qty_30 || 0) > 0
          ? Math.round(Number(ov.qty_total || 0) / (Number(ov.total_sales_qty_30 || 0) / 30)) : null;
        const totalSku = Number(ov.total_sku || 0);
        ov.active_share = totalSku ? Math.round((Number(ov.active_sku || 0) / totalSku) * 100) : 0;
        ov.no_sales_share = totalSku ? Math.round((Number(ov.no_sales_sku || 0) / totalSku) * 100) : 0;
        ov.dead_stock_share = totalSku ? Math.round((Number(ov.dead_stock_sku || 0) / totalSku) * 100) : 0;
        const enriched = segs.map(r => {
          const coverage = Number(r.sales_qty_30 || 0) > 0 ? Math.round(Number(r.qty_total || 0) / (Number(r.sales_qty_30 || 0) / 30)) : null;
          let healthy_status = 'healthy', alert = null;
          if (coverage !== null && coverage < 21 && Number(r.sales_qty_30 || 0) > 0) { healthy_status = 'deficit'; alert = 'Низкое покрытие'; }
          else if (coverage !== null && coverage > 180 && Number(r.sales_qty_30 || 0) < Number(r.sales_qty_365 || 0) / 12) { healthy_status = 'overstock'; alert = 'Избыточный запас'; }
          else if (Number(r.dead_stock_sku || 0) > Math.max(3, Math.round(Number(r.sku_count || 0) * 0.3))) { healthy_status = 'dead'; alert = 'Много мёртвых SKU'; }
          return { ...r, level: 'group', coverage_days: coverage, healthy_status, alert };
        });
        const overstock = [...enriched].filter(s => s.coverage_days != null && s.coverage_days > 180).sort((a,b) => (b.coverage_days||0)-(a.coverage_days||0)).slice(0,5);
        const dead = [...enriched].filter(s => Number(s.dead_stock_sku||0) > 0).sort((a,b) => Number(b.dead_stock_sku||0)-Number(a.dead_stock_sku||0)).slice(0,5);
        const deficit = [...enriched].filter(s => s.coverage_days != null && s.coverage_days < 21 && Number(s.sales_qty_30||0) > 0).sort((a,b) => Number(b.sales_qty_30||0)-Number(a.sales_qty_30||0)).slice(0,5);
        const recommendations = [];
        if (dead.length) recommendations.push({ title: 'Почистить зависшие сегменты', text: `Проверь ${dead[0].name} и соседние блоки: там заметная доля SKU без движения и замороженный капитал.`, severity: 'high' });
        if (deficit.length) recommendations.push({ title: 'Усилить наличие лидеров', text: `Сегмент ${deficit[0].name} продаётся быстро, но покрытие низкое. Это прямой кандидат на усиление закупки.`, severity: 'high' });
        if (overstock.length) recommendations.push({ title: 'Сжать хвост ассортимента', text: `В ${overstock[0].name} запас живёт слишком долго. Стоит пересмотреть ширину матрицы и глубину закупки.`, severity: 'medium' });
        recommendations.push({ title: 'Смотреть сверху вниз', text: 'Используй эту страницу как верхний слой решений: сначала ассортимент целиком, потом группа, потом подгруппа, и только потом конкретные SKU.', severity: 'low' });
        return res.json({ overview: ov, segments: enriched, problem_zones: { overstock, dead_stock: dead, deficit }, recommendations });
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const levelCol = scope === 'subgroup'
      ? `COALESCE(cp.parent_name, cp.group_l${Math.max(0, pathParts.length)})`
      : `COALESCE(cp.group_l1, cp.parent_name, 'Без группы')`;
    const pathExpr = scope === 'subgroup'
      ? `COALESCE(cp.group_full_path, cp.parent_name, 'Без пути')`
      : `COALESCE(cp.group_l0 || ' / ' || cp.group_l1, cp.group_full_path, cp.parent_name, 'Без пути')`;

    const overview = stmt(`
      SELECT
        COUNT(*) AS total_sku,
        SUM(CASE WHEN IFNULL(ls.days_since_last_sale, 9999) <= 90 THEN 1 ELSE 0 END) AS active_sku,
        SUM(CASE WHEN IFNULL(ls.days_since_last_sale, 9999) > 90 THEN 1 ELSE 0 END) AS no_sales_sku,
        SUM(CASE WHEN IFNULL(ls.days_since_last_sale, 9999) > 180 AND IFNULL(cp.qty,0) > 0 THEN 1 ELSE 0 END) AS dead_stock_sku,
        ROUND(SUM(IFNULL(cp.qty,0)), 1) AS qty_total,
        ROUND(SUM(IFNULL(cp.qty,0) * IFNULL(cp.retail_price,0)), 1) AS stock_value_retail,
        ROUND(SUM(IFNULL(cp.qty,0) * IFNULL(cp.purchase_price,0)), 1) AS stock_value_purchase,
        ROUND(SUM(IFNULL(ls.sales_30,0)), 1) AS total_sales_qty_30,
        ROUND(SUM(IFNULL(ls.sales_365,0)), 1) AS total_sales_qty_365
      FROM catalog_products cp
      LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code
      ${where}
    `).get(...params);

    const totalSku = Number(overview.total_sku || 0);
    overview.coverage_days = Number(overview.total_sales_qty_30 || 0) > 0
      ? Math.round(Number(overview.qty_total || 0) / (Number(overview.total_sales_qty_30 || 0) / 30))
      : null;
    overview.active_share = totalSku ? Math.round((Number(overview.active_sku || 0) / totalSku) * 100) : 0;
    overview.no_sales_share = totalSku ? Math.round((Number(overview.no_sales_sku || 0) / totalSku) * 100) : 0;
    overview.dead_stock_share = totalSku ? Math.round((Number(overview.dead_stock_sku || 0) / totalSku) * 100) : 0;

    const segments = stmt(`
      SELECT
        ${levelCol} AS name,
        ${pathExpr} AS path,
        COUNT(*) AS sku_count,
        SUM(CASE WHEN IFNULL(ls.days_since_last_sale, 9999) <= 90 THEN 1 ELSE 0 END) AS active_sku,
        SUM(CASE WHEN IFNULL(ls.days_since_last_sale, 9999) > 90 THEN 1 ELSE 0 END) AS no_sales_sku,
        SUM(CASE WHEN IFNULL(ls.days_since_last_sale, 9999) > 180 AND IFNULL(cp.qty,0) > 0 THEN 1 ELSE 0 END) AS dead_stock_sku,
        ROUND(SUM(IFNULL(cp.qty,0)), 1) AS qty_total,
        ROUND(SUM(IFNULL(cp.qty,0) * IFNULL(cp.purchase_price,0)), 1) AS stock_value_purchase,
        ROUND(SUM(IFNULL(cp.qty,0) * IFNULL(cp.retail_price,0)), 1) AS stock_value_retail,
        ROUND(SUM(IFNULL(ls.sales_30,0)), 1) AS sales_qty_30,
        ROUND(SUM(IFNULL(ls.sales_365,0)), 1) AS sales_qty_365,
        ROUND(AVG(IFNULL(ls.days_since_last_sale, 9999)), 0) AS avg_days_since_last_sale
      FROM catalog_products cp
      LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code
      ${where}
      GROUP BY name, path
      HAVING name IS NOT NULL AND TRIM(name) <> ''
      ORDER BY sales_qty_30 DESC, stock_value_purchase DESC
      LIMIT 30
    `).all(...params).map(r => {
      const coverage = Number(r.sales_qty_30 || 0) > 0 ? Math.round(Number(r.qty_total || 0) / (Number(r.sales_qty_30 || 0) / 30)) : null;
      let healthy_status = 'healthy';
      let alert = null;
      if (coverage !== null && coverage < 21 && Number(r.sales_qty_30 || 0) > 0) { healthy_status = 'deficit'; alert = 'Низкое покрытие'; }
      else if (coverage !== null && coverage > 180 && Number(r.sales_qty_30 || 0) < Number(r.sales_qty_365 || 0) / 12) { healthy_status = 'overstock'; alert = 'Избыточный запас'; }
      else if (Number(r.dead_stock_sku || 0) > Math.max(3, Math.round(Number(r.sku_count || 0) * 0.3))) { healthy_status = 'dead'; alert = 'Много мёртвых SKU'; }
      return { ...r, level: scope === 'subgroup' ? 'subgroup' : 'group', coverage_days: coverage, healthy_status, alert };
    });

    const overstock = [...segments].filter(s => s.coverage_days != null && s.coverage_days > 180).sort((a,b) => (b.coverage_days || 0) - (a.coverage_days || 0)).slice(0,5);
    const dead = [...segments].filter(s => Number(s.dead_stock_sku || 0) > 0).sort((a,b) => Number(b.dead_stock_sku || 0) - Number(a.dead_stock_sku || 0)).slice(0,5);
    const deficit = [...segments].filter(s => s.coverage_days != null && s.coverage_days < 21 && Number(s.sales_qty_30 || 0) > 0).sort((a,b) => Number(b.sales_qty_30 || 0) - Number(a.sales_qty_30 || 0)).slice(0,5);

    const recommendations = [];
    if (dead.length) recommendations.push({ title: 'Почистить зависшие сегменты', text: `Проверь ${dead[0].name} и соседние блоки: там заметная доля SKU без движения и замороженный капитал.`, severity: 'high' });
    if (deficit.length) recommendations.push({ title: 'Усилить наличие лидеров', text: `Сегмент ${deficit[0].name} продаётся быстро, но покрытие низкое. Это прямой кандидат на усиление закупки.`, severity: 'high' });
    if (overstock.length) recommendations.push({ title: 'Сжать хвост ассортимента', text: `В ${overstock[0].name} запас живёт слишком долго. Стоит пересмотреть ширину матрицы и глубину закупки.`, severity: 'medium' });
    recommendations.push({ title: 'Смотреть сверху вниз', text: 'Используй эту страницу как верхний слой решений: сначала ассортимент целиком, потом группа, потом подгруппа, и только потом конкретные SKU.', severity: 'low' });

    res.json({
      overview,
      segments,
      problem_zones: { overstock, dead_stock: dead, deficit },
      recommendations,
    });
  } catch (err) {
    console.error('/api/catalog2/analytics', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/catalog2/item/:code/forecast', (req, res) => {
  try {
    const code = req.params.code.trim();
    const row = stmt('SELECT * FROM catalog_forecast WHERE item_code = ?').get(code);
    if (!row) {
      return res.json({
        item_code: code,
        missing: true,
        calc_date: null,
        peak_months: [],
        anomaly_dates: [],
        anomaly_threshold: null,
      });
    }
    try { row.peak_months = JSON.parse(row.peak_months || '[]'); } catch { row.peak_months = []; }

    // Anomalous days: threshold uses sales-day mean (total/observed), not calendar rate (total/365)
    const salesDayMean = row.observed_days_365 > 0
      ? row.total_net_sales_365 / row.observed_days_365
      : row.avg_day_365;
    const threshold = salesDayMean + 3 * row.std_day_no_anom;
    if (threshold > 0 && row.observed_days_365 >= 5) {
      row.anomaly_dates = stmt(`
        SELECT sale_date,
               ROUND(MAX(0.0, SUM(CAST(sales_qty AS REAL) - CAST(return_qty AS REAL))), 1) AS net_qty
        FROM catalog_sales
        WHERE item_code = ? AND sale_date >= date(?, '-365 days')
        GROUP BY sale_date
        HAVING net_qty > ?
        ORDER BY net_qty DESC
        LIMIT 10
      `).all(code, row.calc_date, threshold);
    } else {
      row.anomaly_dates = [];
    }
    row.anomaly_threshold = Math.round(threshold * 10) / 10;

    row.active_orders = stmt(`
      SELECT pob.id, COALESCE(pob.batch_name, pob.supplier_name, '') AS batch_name, pob.status,
             pob.manager_name, ROUND(SUM(COALESCE(poi.final_qty, poi.manager_qty, 0)), 2) AS qty
      FROM purchase_order_items poi
      JOIN purchase_order_batches pob ON pob.id = poi.batch_id
      WHERE poi.item_ref = ? AND pob.status = 'in_delivery'
      GROUP BY pob.id
      ORDER BY pob.id DESC
    `).all(code);
    row.in_delivery_qty = row.active_orders.reduce((s, x) => s + Number(x.qty || 0), 0);
    const cpRow = stmt(`SELECT COALESCE(qty, 0) AS qty FROM catalog_products WHERE item_code = ? LIMIT 1`).get(code);
    row.current_qty = Number(cpRow?.qty || 0);
    if (typeof row.recommended_stock === 'number') {
      row.to_order_adjusted = Math.max(0, Math.ceil(Number(row.recommended_stock || 0) - row.current_qty - Number(row.in_delivery_qty || 0)));
    }
    res.json(row);
  } catch (err) { res.status(500).json({error: err.message}); }
});

// Returns single product detail by id or item_code
app.get('/api/catalog2/item/:code', (req, res) => {
  try {
    const code = req.params.code;
    const row = stmt(`SELECT * FROM catalog_products WHERE item_code = ? LIMIT 1`).get(code)
             || stmt(`SELECT * FROM catalog_products WHERE id = ? LIMIT 1`).get(code);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sales chart data: aggregated by day / week / month, gaps filled with zeros
app.get('/api/catalog2/item/:code/sales', (req, res) => {
  try {
    const code = req.params.code;
    const from = String(req.query.from || '2024-01-01').slice(0, 10);
    const to   = String(req.query.to   || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const gran = String(req.query.gran || 'month');

    function parseLocal(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    function fmtDay(d) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function sqliteWeek(d) {
      const year = d.getFullYear();
      const jan1 = new Date(year, 0, 1);
      const doy = Math.floor((d - jan1) / 86400000);
      const jan1Day = jan1.getDay();
      const toFirstMon = jan1Day === 1 ? 0 : jan1Day === 0 ? 1 : 8 - jan1Day;
      if (doy < toFirstMon) return `${year}-W00`;
      return `${year}-W${String(Math.floor((doy - toFirstMon) / 7) + 1).padStart(2, '0')}`;
    }
    function periodKey(d) {
      if (gran === 'day') return fmtDay(d);
      if (gran === 'week') return sqliteWeek(d);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}`;
    }

    const salesRows = stmt(`
      SELECT sale_date AS day,
             SUM(COALESCE(sales_qty,0))  AS sales,
             SUM(COALESCE(return_qty,0)) AS returns
      FROM catalog_sales
      WHERE item_code = ? AND sale_date >= ? AND sale_date <= ?
      GROUP BY sale_date
      ORDER BY sale_date ASC
    `).all(code, from, to);

    const receiptRows = stmt(`
      SELECT receipt_date AS day,
             SUM(COALESCE(qty,0)) AS receipts
      FROM catalog_receipts
      WHERE item_code = ? AND receipt_date >= ? AND receipt_date <= ?
      GROUP BY receipt_date
      ORDER BY receipt_date ASC
    `).all(code, from, to);

    const currentStockRow = stmt(`
      SELECT COALESCE(qty, 0) AS qty
      FROM catalog_products
      WHERE item_code = ?
      LIMIT 1
    `).get(code);
    const currentStock = Number(currentStockRow?.qty || 0);

    const salesByDay = new Map(salesRows.map(r => [String(r.day).slice(0,10), {sales: Number(r.sales || 0), returns: Number(r.returns || 0)}]));
    const receiptsByDay = new Map(receiptRows.map(r => [String(r.day).slice(0,10), Number(r.receipts || 0)]));

    const fromDate = parseLocal(from);
    const toDate   = parseLocal(to);
    const days = [];
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const day = fmtDay(d);
      const sr = salesByDay.get(day) || {sales: 0, returns: 0};
      const receipts = receiptsByDay.get(day) || 0;
      days.push({day, sales: sr.sales, returns: sr.returns, receipts});
    }

    let stockCursor = currentStock;
    const estimatedByDay = new Map();
    for (let i = days.length - 1; i >= 0; i--) {
      const row = days[i];
      estimatedByDay.set(row.day, Math.max(0, stockCursor));
      stockCursor = stockCursor - row.receipts + row.sales - row.returns;
    }

    const buckets = new Map();
    for (const row of days) {
      const d = parseLocal(row.day);
      const period = periodKey(d);
      const prev = buckets.get(period) || {period, sales: 0, returns: 0, receipts: 0, estimated_stock: null, stock_min: null, stock_max: null};
      prev.sales += row.sales;
      prev.returns += row.returns;
      prev.receipts += row.receipts;
      const est = Number(estimatedByDay.get(row.day) || 0);
      prev.estimated_stock = est;
      prev.stock_min = prev.stock_min == null ? est : Math.min(prev.stock_min, est);
      prev.stock_max = prev.stock_max == null ? est : Math.max(prev.stock_max, est);
      buckets.set(period, prev);
    }

    const filled = Array.from(buckets.values()).sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const hasData = filled.some(r => r.sales || r.returns || r.receipts || r.estimated_stock != null);

    res.json({
      series: filled,
      has_data: hasData,
      gran,
      meta: {
        current_stock: currentStock,
        reconstructed: true,
        has_receipts: receiptRows.length > 0,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import sales records (batch insert)
app.post('/api/catalog2/sales', (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'body must be array' });
    const insert = stmt(`
      INSERT INTO catalog_sales (sale_date, store, item_code, sales_qty, return_qty)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows) => {
      for (const r of rows) insert.run(r.date, r.store || '', r.itemCode, r.salesQty ?? 0, r.returnQty ?? 0);
    });
    insertMany(records);
    res.json({ ok: true, inserted: records.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Analytics API ─────────────────────────────────────────────────────────────

const OVERSTOCK_DAYS = 56;
const NLQ_DAYS = 120;

app.get('/api/analytics/summary', (req, res) => {
  try {
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];

    // Fast path: serve pre-computed cache when no path filter
    if (!pathParts.length) {
      const cached = stmt(`SELECT value FROM _analytics_cache WHERE key='summary'`).get();
      if (cached) return res.json(JSON.parse(cached.value));
    }

    const { where: pw, params: pp } = catalogPathWhere(pathParts);
    const cpFilter = pw ? `AND ${pw}` : '';

    const agg = stmt(`
      SELECT
        SUM(CASE WHEN is_nlq=0 AND is_over=0 THEN 1 ELSE 0 END) AS normal_cnt,
        SUM(CASE WHEN is_nlq=0 AND is_over=1 THEN 1 ELSE 0 END) AS over_cnt,
        SUM(CASE WHEN is_nlq=1 AND is_over=0 THEN 1 ELSE 0 END) AS nlq_cnt,
        SUM(CASE WHEN is_nlq=1 AND is_over=1 THEN 1 ELSE 0 END) AS both_cnt,
        SUM(CASE WHEN is_nlq=0 AND is_over=0 THEN val ELSE 0 END) AS normal_val,
        SUM(CASE WHEN is_nlq=0 AND is_over=1 THEN val ELSE 0 END) AS over_val,
        SUM(CASE WHEN is_nlq=1 AND is_over=0 THEN val ELSE 0 END) AS nlq_val,
        SUM(CASE WHEN is_nlq=1 AND is_over=1 THEN val ELSE 0 END) AS both_val
      FROM (
        SELECT
          CASE WHEN IFNULL(ls.days_since_last_sale, 9999) > ${NLQ_DAYS} THEN 1 ELSE 0 END AS is_nlq,
          CASE WHEN IFNULL(cf.forecast_day_matrix,0)>0 AND cp.qty>1
                    AND cp.qty/cf.forecast_day_matrix>${OVERSTOCK_DAYS} THEN 1 ELSE 0 END AS is_over,
          cp.qty * IFNULL(cp.purchase_price,0) AS val
        FROM catalog_products cp
        LEFT JOIN catalog_forecast cf ON cf.item_code = cp.item_code
        LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code
        WHERE cp.qty > 0 ${cpFilter}
      )
    `).get(...pp);

    // pre_season needs JSON parsing - only fetch items that have forecast_to_order > 0
    const curM = new Date().getMonth() + 1;
    const preSeasonRows = stmt(`
      SELECT cf.peak_months
      FROM catalog_products cp
      JOIN catalog_forecast cf ON cf.item_code = cp.item_code
      WHERE cp.qty > 0 AND cf.to_order > 0 AND cf.peak_months IS NOT NULL ${cpFilter}
    `).all(...pp);
    let preSeasonCount = 0;
    for (const r of preSeasonRows) {
      try {
        const pm = JSON.parse(r.peak_months);
        if (pm.some(m => { const d = ((m - curM + 12) % 12); return d >= 1 && d <= 3; })) preSeasonCount++;
      } catch {}
    }

    res.json({
      segments: {
        normal:        { count: agg.normal_cnt, value: Math.round(agg.normal_val) },
        overstock_only:{ count: agg.over_cnt,   value: Math.round(agg.over_val)   },
        nlq_only:      { count: agg.nlq_cnt,    value: Math.round(agg.nlq_val)    },
        both:          { count: agg.both_cnt,   value: Math.round(agg.both_val)   },
      },
      pre_season_count: preSeasonCount,
      total_with_stock: agg.normal_cnt + agg.over_cnt + agg.nlq_cnt + agg.both_cnt,
      total_stock_value: Math.round(agg.normal_val + agg.over_val + agg.nlq_val + agg.both_val),
    });
  } catch (err) {
    console.error('/api/analytics/summary', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/sales-by-year', (req, res) => {
  try {
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];
    const { where: pw, params: pp } = catalogPathWhere(pathParts);
    const cpFilter = pw ? `AND ${pw}` : '';

    let rows;
    if (!cpFilter) {
      rows = stmt(`SELECT year, month, net_qty, revenue FROM _monthly_sales ORDER BY year, month`).all();
    } else {
      rows = stmt(`
        SELECT CAST(strftime('%Y', cs.sale_date) AS INTEGER) AS year,
               CAST(strftime('%m', cs.sale_date) AS INTEGER) AS month,
               ROUND(SUM(MAX(0.0, CAST(cs.sales_qty AS REAL) - CAST(cs.return_qty AS REAL))), 1) AS net_qty,
               ROUND(SUM(MAX(0.0, CAST(cs.sales_qty AS REAL) - CAST(cs.return_qty AS REAL))
                         * COALESCE(cp.retail_price, 0)), 1) AS revenue
        FROM catalog_sales cs
        JOIN catalog_products cp ON cp.item_code = cs.item_code
        WHERE cs.sale_date >= '2024-01-01' ${cpFilter}
        GROUP BY year, month
        ORDER BY year, month
      `).all(...pp);
    }

    res.json(rows);
  } catch (err) {
    console.error('/api/analytics/sales-by-year', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/suppliers', (req, res) => {
  try {
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];
    const { where: pw, params: pp } = catalogPathWhere(pathParts);
    const cpFilter = pw ? `AND ${pw}` : '';

    const itemRows = stmt(`
      SELECT s.supplier_name,
             CAST(cp.qty AS REAL) AS qty,
             CAST(cp.purchase_price AS REAL) AS purchase_price,
             cf.forecast_day_matrix,
             cf.abc_class, cf.xyz_class,
             cf.to_order AS forecast_to_order,
             cf.peak_months,
             CAST(julianday('now') - julianday(ls.last_sale_date) AS INTEGER) AS days_since_last_sale
      FROM catalog_products cp
      JOIN products pr ON pr.barcode = cp.barcode
                       AND cp.barcode IS NOT NULL AND length(cp.barcode) >= 6
      JOIN product_supplier_map psm ON psm.product_id = pr.id AND psm.is_primary = 1
      JOIN suppliers s ON s.id = psm.supplier_id
      LEFT JOIN catalog_forecast cf ON cf.item_code = cp.item_code
      LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code
      WHERE cp.qty > 0 ${cpFilter}
    `).all(...pp);

    const now = new Date();
    const curM = now.getMonth() + 1;
    const supMap = new Map();

    for (const row of itemRows) {
      if (!supMap.has(row.supplier_name)) {
        supMap.set(row.supplier_name, {
          supplier_name: row.supplier_name, items_with_stock: 0,
          nlq_count: 0, nlq_value: 0, overstock_count: 0, overstock_value: 0,
          both_count: 0, both_value: 0, total_value: 0,
          abc_a_count: 0, xyz_x_count: 0, pre_season_count: 0,
        });
      }
      const s = supMap.get(row.supplier_name);
      s.items_with_stock++;
      const rate = row.forecast_day_matrix || 0;
      const isOverstock = rate > 0 && row.qty > 1 && (row.qty / rate) > OVERSTOCK_DAYS;
      const isNlq = row.days_since_last_sale === null || row.days_since_last_sale > NLQ_DAYS;
      const val = row.qty * (row.purchase_price || 0);
      s.total_value += val;
      if (isNlq) { s.nlq_count++; s.nlq_value += val; }
      if (isOverstock) { s.overstock_count++; s.overstock_value += val; }
      if (isNlq && isOverstock) { s.both_count++; s.both_value += val; }
      if (row.abc_class === 'A') s.abc_a_count++;
      if (row.xyz_class === 'X') s.xyz_x_count++;
      let pm = [];
      try { pm = JSON.parse(row.peak_months || '[]'); } catch {}
      if (pm.some(m => { const d = ((m - curM + 12) % 12); return d >= 1 && d <= 3; }) && (row.forecast_to_order || 0) > 0) s.pre_season_count++;
    }

    const results = Array.from(supMap.values()).map(s => {
      const base = s.items_with_stock || 1;
      const nlqRatio   = s.nlq_count      / base;
      const osRatio    = s.overstock_count / base;
      const abcARatio  = s.abc_a_count     / base;
      const xyzXRatio  = s.xyz_x_count     / base;
      const score = Math.round(((1 - nlqRatio) * 0.35 + (1 - osRatio) * 0.35 + abcARatio * 0.20 + xyzXRatio * 0.10) * 100);
      return {
        ...s,
        nlq_value:      Math.round(s.nlq_value),
        overstock_value:Math.round(s.overstock_value),
        total_value:    Math.round(s.total_value),
        nlq_pct:   Math.round(nlqRatio  * 100),
        os_pct:    Math.round(osRatio   * 100),
        score,
      };
    });
    results.sort((a, b) => b.nlq_count - a.nlq_count);
    res.json(results);
  } catch (err) {
    console.error('/api/analytics/suppliers', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/items', (req, res) => {
  try {
    const pathStr    = String(req.query.path     || '');
    const segment    = String(req.query.segment  || 'overstock_only');
    const supplierName = String(req.query.supplier || '');
    const limit      = Math.min(200, Math.max(1, Number(req.query.limit  || 100)));
    const offset     = Math.max(0, Number(req.query.offset || 0));

    const pathParts  = pathStr ? pathStr.split(' / ') : [];
    const { where: pw, params: pp } = catalogPathWhere(pathParts);

    const conditions = ['cp.qty > 0'];
    const params     = [...pp];

    if (pw) conditions.push(pw);

    const overstockCond = `(cf.forecast_day_matrix > 0 AND cp.qty > 1 AND CAST(cp.qty AS REAL)/cf.forecast_day_matrix > ${OVERSTOCK_DAYS})`;
    const nlqCond       = `(ls.last_sale_date IS NULL OR IFNULL(ls.days_since_last_sale, 9999) > ${NLQ_DAYS})`;

    if (segment === 'overstock_only') {
      conditions.push(overstockCond, `NOT ${nlqCond}`);
    } else if (segment === 'nlq_only') {
      conditions.push(nlqCond, `NOT ${overstockCond}`);
    } else if (segment === 'both') {
      conditions.push(overstockCond, nlqCond);
    } else if (segment === 'normal') {
      conditions.push(`NOT ${overstockCond}`, `NOT ${nlqCond}`);
    } else if (segment === 'pre_season') {
      const curM = new Date().getMonth() + 1;
      const upcoming = [1, 2, 3].map(d => ((curM - 1 + d) % 12) + 1);
      const peakLikes = upcoming.map(() => `cf.peak_months LIKE ?`).join(' OR ');
      conditions.push(`(${peakLikes})`, `CAST(COALESCE(cf.to_order, 0) AS INTEGER) > 0`);
      params.push(...upcoming.map(m => `%${m}%`));
    } else if (segment === 'all_nlq') {
      conditions.push(nlqCond);
    } else if (segment === 'all_overstock') {
      conditions.push(overstockCond);
    }

    let supplierJoin = '';
    if (supplierName) {
      supplierJoin = `
        JOIN products pr2 ON pr2.barcode = cp.barcode AND cp.barcode IS NOT NULL AND length(cp.barcode) >= 6
        JOIN product_supplier_map psm2 ON psm2.product_id = pr2.id AND psm2.is_primary = 1
        JOIN suppliers s2 ON s2.id = psm2.supplier_id AND s2.supplier_name = ?`;
      params.push(supplierName);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const baseJoins = `
      LEFT JOIN catalog_forecast cf ON cf.item_code = cp.item_code
      LEFT JOIN _sales_cache ls ON ls.item_code = cp.item_code
      ${supplierJoin}
    `;

    const total = stmt(`
      SELECT COUNT(*) AS cnt FROM catalog_products cp ${baseJoins} ${where}
    `).get(...params).cnt;

    const items = stmt(`
      SELECT cp.id, cp.item_code, cp.item_name, cp.barcode, cp.qty,
             cp.purchase_price, cp.retail_price,
             cp.parent_name, cp.group_l0, cp.group_l1, cp.group_full_path,
             cf.forecast_day_matrix, cf.abc_class, cf.xyz_class,
             cf.to_order AS forecast_to_order,
             ls.last_sale_date,
             ls.days_since_last_sale,
             CASE WHEN cf.forecast_day_matrix > 0
               THEN ROUND(CAST(cp.qty AS REAL) / cf.forecast_day_matrix, 0)
               ELSE NULL END AS coverage_days
      FROM catalog_products cp ${baseJoins} ${where}
      ORDER BY cp.qty * COALESCE(cp.purchase_price, 0) DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ items, total, limit, offset, has_more: offset + items.length < total });
  } catch (err) {
    console.error('/api/analytics/items', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const distDir = path.resolve(__dirname, 'dist');
app.use('/inventory-manager-web/assets', express.static(path.join(distDir, 'assets'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
}));
app.use(express.static(distDir, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
}));
app.get('/api/analytics/weekly', (req, res) => {
  try {
    const fmt = d => d.toISOString().split('T')[0];
    const shiftYear = (dateStr, years) => {
      const d = new Date(dateStr + 'T12:00:00');
      return fmt(new Date(d.getFullYear() + years, d.getMonth(), d.getDate()));
    };

    // Accept explicit from/to or fall back to last complete Mon-Sun week
    let from = String(req.query.from || '');
    let to   = String(req.query.to   || '');
    if (!from || !to) {
      const today = new Date();
      const dow = today.getDay();
      const daysToMon = dow === 0 ? 6 : dow - 1;
      const thisMon = new Date(today); thisMon.setDate(today.getDate() - daysToMon);
      const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
      from = fmt(lastMon);
      to   = fmt(lastSun);
    }

    const fromLY = shiftYear(from, -1), toLY = shiftYear(to, -1);
    const from2Y = shiftYear(from, -2), to2Y = shiftYear(to, -2);

    // Path filter
    const pathStr = String(req.query.path || '');
    const pathParts = pathStr ? pathStr.split(' / ') : [];
    const { where: pw, params: pp } = catalogPathWhere(pathParts);
    const depth = pathParts.length;
    const childCol = `group_l${depth}`;
    const cpAnd = pw ? `AND ${pw.replace(/\b(group_l\d+|parent_name)\b/g, 'cp.$1')}` : '';

    // Totals: all metrics in one query
    const totals = stmt(`
      SELECT
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_this,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_ly,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_2y,
        COUNT(DISTINCT CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.item_code END) AS sku_this,
        COUNT(DISTINCT CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.item_code END) AS sku_ly,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN (cs.sales_qty-cs.return_qty)*COALESCE(cp.retail_price,0) ELSE 0 END) AS rev_this,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN (cs.sales_qty-cs.return_qty)*COALESCE(cp.retail_price,0) ELSE 0 END) AS rev_ly
      FROM catalog_sales cs
      LEFT JOIN catalog_products cp ON cp.item_code = cs.item_code
      WHERE ((cs.sale_date BETWEEN ? AND ?) OR (cs.sale_date BETWEEN ? AND ?) OR (cs.sale_date BETWEEN ? AND ?))
        ${cpAnd}
    `).get(
      from, to, fromLY, toLY, from2Y, to2Y,
      from, to, fromLY, toLY,
      from, to, fromLY, toLY,
      from, to, fromLY, toLY, from2Y, to2Y,
      ...pp
    );

    // Next-level children breakdown (clickable for drill-down)
    const children = depth <= 8 ? stmt(`
      SELECT
        cp.${childCol} AS name,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_this,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_ly,
        SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN (cs.sales_qty-cs.return_qty)*COALESCE(cp.retail_price,0) ELSE 0 END) AS rev_this
      FROM catalog_sales cs
      JOIN catalog_products cp ON cp.item_code = cs.item_code
      WHERE ((cs.sale_date BETWEEN ? AND ?) OR (cs.sale_date BETWEEN ? AND ?))
        AND cp.${childCol} IS NOT NULL
        ${cpAnd}
      GROUP BY cp.${childCol}
      ORDER BY qty_this DESC
      LIMIT 20
    `).all(from, to, fromLY, toLY, from, to, from, to, fromLY, toLY, ...pp) : [];

    // Top 30 selling items in this path
    const topItems = stmt(`
      SELECT cs.item_code, cp.item_name, cp.group_l1,
             SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_this,
             SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN cs.sales_qty-cs.return_qty ELSE 0 END) AS qty_ly,
             SUM(CASE WHEN cs.sale_date BETWEEN ? AND ? THEN (cs.sales_qty-cs.return_qty)*COALESCE(cp.retail_price,0) ELSE 0 END) AS rev_this
      FROM catalog_sales cs
      LEFT JOIN catalog_products cp ON cp.item_code = cs.item_code
      WHERE ((cs.sale_date BETWEEN ? AND ?) OR (cs.sale_date BETWEEN ? AND ?))
        ${cpAnd}
      GROUP BY cs.item_code
      HAVING qty_this > 0
      ORDER BY qty_this DESC
      LIMIT 30
    `).all(from, to, fromLY, toLY, from, to, from, to, fromLY, toLY, ...pp);

    // Items that had a gap >60 days before the period and then sold during it
    const nlqSold = stmt(`
      WITH period_sold AS (
        SELECT cs.item_code, SUM(cs.sales_qty-cs.return_qty) AS net_qty
        FROM catalog_sales cs
        JOIN catalog_products cp ON cp.item_code = cs.item_code
        WHERE cs.sale_date BETWEEN ? AND ?
          ${cpAnd}
        GROUP BY cs.item_code HAVING net_qty > 0
      ),
      prev_sale AS (
        SELECT item_code,
               ROUND(julianday(?) - julianday(MAX(sale_date))) AS days_gap
        FROM catalog_sales
        WHERE sale_date < ?
          AND item_code IN (SELECT item_code FROM period_sold)
        GROUP BY item_code
      )
      SELECT ws.item_code, cp.item_name, cp.group_l1,
             ROUND(ws.net_qty,1) AS net_qty,
             ps.days_gap,
             ROUND(ws.net_qty*COALESCE(cp.retail_price,0)) AS revenue
      FROM period_sold ws
      JOIN prev_sale ps ON ps.item_code = ws.item_code
      LEFT JOIN catalog_products cp ON cp.item_code = ws.item_code
      WHERE ps.days_gap > 60
      ORDER BY ps.days_gap DESC
      LIMIT 100
    `).all(from, to, ...pp, from, from);

    // Daily aggregation for trend chart
    const dailySales = stmt(`
      SELECT cs.sale_date AS date,
             ROUND(SUM(cs.sales_qty-cs.return_qty), 1) AS qty,
             ROUND(SUM((cs.sales_qty-cs.return_qty)*COALESCE(cp.retail_price,0))) AS rev
      FROM catalog_sales cs
      LEFT JOIN catalog_products cp ON cp.item_code = cs.item_code
      WHERE cs.sale_date BETWEEN ? AND ?
        ${cpAnd}
      GROUP BY cs.sale_date
      ORDER BY cs.sale_date
    `).all(from, to, ...pp);

    const dailySalesLY = stmt(`
      SELECT cs.sale_date AS date,
             ROUND(SUM(cs.sales_qty-cs.return_qty), 1) AS qty,
             ROUND(SUM((cs.sales_qty-cs.return_qty)*COALESCE(cp.retail_price,0))) AS rev
      FROM catalog_sales cs
      LEFT JOIN catalog_products cp ON cp.item_code = cs.item_code
      WHERE cs.sale_date BETWEEN ? AND ?
        ${cpAnd}
      GROUP BY cs.sale_date
      ORDER BY cs.sale_date
    `).all(fromLY, toLY, ...pp);

    res.json({ period: { from, to }, path: pathStr, totals, children, topItems, nlqSold, dailySales, dailySalesLY });
  } catch (err) {
    console.error('/api/analytics/weekly', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.sendFile(path.join(distDir, 'index.html'));
});

// Pre-warm statement cache and SQLite page cache at startup
setTimeout(() => {
  try {
    stmt(`SELECT group_l0, COUNT(*) FROM catalog_products WHERE group_l0 IS NOT NULL GROUP BY group_l0`).all();
    stmt(`SELECT COUNT(*) FROM catalog_products`).get();
    stmt(`SELECT cp.item_code FROM catalog_products cp LEFT JOIN _sales_cache ls ON ls.item_code=cp.item_code LEFT JOIN catalog_forecast cf ON cf.item_code=cp.item_code ORDER BY cp.qty DESC NULLS LAST LIMIT 1`).all();
    stmt(`SELECT DISTINCT pr.supplier_name FROM purchase_recommendations pr WHERE pr.supplier_name IS NOT NULL AND pr.supplier_name != '' AND pr.supplier_name != 'UNMAPPED_SUPPLIER' AND pr.calc_date=(SELECT MAX(calc_date) FROM purchase_recommendations) ORDER BY pr.supplier_name`).all();
    stmt(`SELECT value FROM _analytics_cache WHERE key='summary'`).get();
    stmt(`SELECT value FROM _analytics_cache WHERE key='analytics_all'`).get();
    stmt(`SELECT year, month, net_qty, revenue FROM _monthly_sales ORDER BY year, month`).all();
    stmt(`SELECT COUNT(CASE WHEN status IN ('urgent_order','order','pre_season_order','limited_history_manual_check') AND to_order > 0 THEN 1 END) AS total_to_order FROM purchase_recommendations WHERE calc_date=(SELECT MAX(calc_date) FROM purchase_recommendations)`).get();
    console.log('stmt cache warmed');
  } catch(e) { console.warn('warm-up skipped:', e.message); }
}, 100);

const port = Number(process.env.PORT || 8787);
app.listen(port, '0.0.0.0', () => {
  console.log(`inventory-manager-web listening on ${port}`);
  console.log(`db: ${dbPath}`);
});
