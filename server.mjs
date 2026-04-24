import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.INVENTORY_DB || path.resolve(__dirname, '../inventory_mvp/db/inventory_mvp.sqlite');
const corsOrigin = process.env.CORS_ORIGIN || '*';
const db = new Database(dbPath);
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

try {
  db.exec(`
    ALTER TABLE purchase_order_batches ADD COLUMN draft_mode TEXT;
    ALTER TABLE purchase_order_batches ADD COLUMN is_draft INTEGER DEFAULT 0;
  `);
} catch {}
try {
  db.exec(`ALTER TABLE purchase_order_items ADD COLUMN reason TEXT;`);
} catch {}

db.prepare("UPDATE purchase_order_batches SET is_draft = 0 WHERE status = 'completed'").run();
try { db.prepare("DELETE FROM purchase_order_batches WHERE is_draft = 1").run(); } catch {}

app.get('/api/suppliers', (_req, res) => {
  const rows = db.prepare(`
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
  const sup = db.prepare('SELECT id FROM suppliers WHERE supplier_name = ?').get(name);
  if (!sup) return res.status(404).json({error: 'supplier not found'});
  if (lead_time_days != null)
    db.prepare('UPDATE suppliers SET lead_time_days = ? WHERE supplier_name = ?').run(Number(lead_time_days), name);
  if (order_cycle_days != null)
    db.prepare('UPDATE suppliers SET order_cycle_days = ? WHERE supplier_name = ?').run(Number(order_cycle_days), name);
  if (moq_qty != null)
    db.prepare('UPDATE suppliers SET moq_qty = ? WHERE supplier_name = ?').run(moq_qty === '' ? null : Number(moq_qty), name);
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
  const rows = db.prepare(`
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
  const rows = db.prepare(`
    ${PR_SELECT}
      ${prDedupSql('(sku_name LIKE ? OR norm_name LIKE ? OR item_ref LIKE ?)')}
    ) r
    ORDER BY r.to_order DESC, r.sku_name ASC
    LIMIT 30
  `).all(q, q, q);
  res.json(rows);
});

app.get('/api/dashboard', (_req, res) => {
  const stats = db.prepare(`
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
  const rows = db.prepare(`
    SELECT md.decision_date, md.manager_name, md.sku_name, md.system_qty, md.manager_qty,
           md.delta_qty, md.reason, md.supplier_name
    FROM manager_decisions md
    ORDER BY md.id DESC
    LIMIT 200
  `).all();
  res.json(rows);
});

app.get('/api/non-liquid/groups', (_req, res) => {
  const snapshotExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='non_liquid_snapshot'`).get();
  if (snapshotExists) {
    const rows = db.prepare(`
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
  const rows = db.prepare(`
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
  const snapshotExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='non_liquid_snapshot'`).get();

  if (snapshotExists) {
    const rows = db.prepare(`
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
  const rows = db.prepare(`
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
  const snapshotExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='non_liquid_snapshot'`).get();

  if (snapshotExists) {
    const whereSql = `
      FROM non_liquid_snapshot
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM non_liquid_snapshot)
        AND (? = '' OR subgroup = ?)
        AND (? = '' OR sku_name LIKE ? OR item_ref LIKE ? OR norm_name LIKE ?)
    `;
    const params = [subgroup, subgroup, q, qLike, qLike, qLike];
    const total = db.prepare(`SELECT COUNT(*) AS total ${whereSql}`).get(...params).total;
    const rows = db.prepare(`
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
  const total = db.prepare(`SELECT COUNT(*) AS total FROM (${baseSql})`).get(...params).total;
  const rows = db.prepare(`
    ${baseSql}
    ORDER BY COALESCE(days_since_last_sale, 99999) DESC, available_qty DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({items: rows, total, limit, offset, has_more: offset + rows.length < total});
});

app.post('/api/coverage/supplier', (req, res) => {
  const {supplier_name, coverage_days} = req.body;
  if (!supplier_name) return res.status(400).send('supplier_name required');
  db.prepare('UPDATE suppliers SET coverage_days = ? WHERE supplier_name = ?').run(coverage_days ?? null, supplier_name);
  res.json({ok: true});
});

app.post('/api/coverage/product', (req, res) => {
  const {norm_name, coverage_days} = req.body;
  if (!norm_name) return res.status(400).send('norm_name required');
  db.prepare('UPDATE products SET coverage_days = ? WHERE norm_name = ?').run(coverage_days ?? null, norm_name);
  res.json({ok: true});
});

app.get('/api/drafts', (_req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.supplier_name, b.status, b.created_at, b.draft_mode,
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
  const row = db.prepare(`SELECT id, supplier_name, status, created_at, draft_mode FROM purchase_order_batches WHERE is_draft = 1 ORDER BY id DESC LIMIT 1`).get();
  res.json(row || null);
});

app.post('/api/drafts', (req, res) => {
  const {draft_mode} = req.body;
  const result = db.prepare(`INSERT INTO purchase_order_batches (batch_date, supplier_name, status, draft_mode, is_draft) VALUES (date(), '', 'draft', ?, 1)`).run(draft_mode || 'single');
  res.json({id: result.lastInsertRowid});
});

app.get('/api/drafts/:id', (req, res) => {
  const batch = db.prepare(`SELECT id, supplier_name, status, created_at, draft_mode FROM purchase_order_batches WHERE id = ?`).get(req.params.id);
  const items = db.prepare(`SELECT id, recommendation_id, item_ref, sku_name, norm_name, recommended_qty, manager_qty, final_qty, reason FROM purchase_order_items WHERE batch_id = ? ORDER BY id DESC`).all(req.params.id);
  res.json({batch, items});
});

app.post('/api/drafts/:id/items', (req, res) => {
  const {item} = req.body;
  const rec = db.prepare(`SELECT id, item_ref, sku_name, norm_name, to_order FROM purchase_recommendations WHERE id = ?`).get(item.recommendation_id);
  if (!rec) return res.status(404).send('recommendation not found');
  const exists = db.prepare(`SELECT id FROM purchase_order_items WHERE batch_id = ? AND recommendation_id = ?`).get(req.params.id, item.recommendation_id);
  if (exists) return res.json({ok: true, existing: true});
  db.prepare(`UPDATE purchase_order_batches SET supplier_name = CASE WHEN supplier_name = '' THEN ? ELSE supplier_name END WHERE id = ?`).run(item.supplier_name || '', req.params.id);
  db.prepare(`INSERT INTO purchase_order_items (batch_id, recommendation_id, item_ref, sku_name, norm_name, recommended_qty, manager_qty, final_qty, item_status, reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`)
    .run(req.params.id, rec.id, rec.item_ref, rec.sku_name, rec.norm_name, rec.to_order, item.manager_qty ?? rec.to_order, item.manager_qty ?? rec.to_order, item.reason || '');
  res.json({ok: true});
});

app.post('/api/drafts/:id/items/:itemId', (req, res) => {
  const {manager_qty, reason} = req.body;
  db.prepare(`UPDATE purchase_order_items SET manager_qty = ?, final_qty = ?, reason = ? WHERE id = ? AND batch_id = ?`).run(manager_qty, manager_qty, reason || '', req.params.itemId, req.params.id);
  res.json({ok: true});
});

app.delete('/api/drafts/:id/items/:itemId', (req, res) => {
  db.prepare(`DELETE FROM purchase_order_items WHERE id = ? AND batch_id = ?`).run(req.params.itemId, req.params.id);
  res.json({ok: true});
});

app.get('/api/orders', (_req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.supplier_name, b.status, b.created_at,
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
  const batch = db.prepare(`SELECT id, supplier_name, status, created_at FROM purchase_order_batches WHERE id = ?`).get(req.params.id);
  const items = db.prepare(`SELECT id, sku_name, item_ref, recommended_qty, manager_qty, final_qty, reason, item_status FROM purchase_order_items WHERE batch_id = ? ORDER BY id DESC`).all(req.params.id);
  res.json({batch, items});
});

app.post('/api/drafts/:id/submit', (req, res) => {
  const batchId = req.params.id;
  const items = db.prepare(`SELECT i.*, r.supplier_name, r.store, r.item_ref AS rec_item_ref, r.sku_name AS rec_sku_name, r.norm_name, r.to_order
                            FROM purchase_order_items i
                            LEFT JOIN purchase_recommendations r ON r.id = i.recommendation_id
                            WHERE i.batch_id = ?`).all(batchId);
  for (const item of items) {
    db.prepare(`INSERT INTO manager_decisions (decision_date, recommendation_id, supplier_name, store, item_ref, sku_name, norm_name, system_qty, manager_qty, delta_qty, reason, manager_name)
                VALUES (date(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manager')`)
      .run(item.recommendation_id, item.supplier_name || '', item.store || '', item.rec_item_ref || item.item_ref || '', item.rec_sku_name || item.sku_name, item.norm_name || '', item.recommended_qty || item.to_order || 0, item.manager_qty || 0, (item.manager_qty || 0) - (item.recommended_qty || item.to_order || 0), item.reason || '');
  }
  db.prepare(`UPDATE purchase_order_batches SET is_draft = 0, supplier_name = COALESCE(NULLIF(supplier_name,''), 'multi-supplier') WHERE id = ?`).run(batchId);
  res.json({ok: true});
});

app.post('/api/orders/:id/complete', (req, res) => {
  db.prepare("UPDATE purchase_order_batches SET status = 'completed' WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE purchase_order_items SET item_status = 'completed' WHERE batch_id = ?").run(req.params.id);
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
    ${where}
  `;

  try {
    const total = db.prepare(`SELECT COUNT(*) AS total ${baseSql}`).get(...params).total;
    const rows  = db.prepare(`
      SELECT r.sku_name, r.item_ref, p.barcode,
             ss.subgroup,
             r.available_qty,
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
    const rows = db.prepare(`
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
  return { where: clauses.join(' AND '), params: pathParts };
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

    const children = db.prepare(`
      SELECT ${childCol} AS name, COUNT(*) AS item_count
      FROM catalog_products
      WHERE ${baseWhere}
      GROUP BY ${childCol}
      ORDER BY ${childCol} ASC
    `).all(...pp);

    // Count direct items (leaves) exactly at this path depth
    const directWhere = pw ? `${pw} AND group_depth = ${depth}` : `group_depth = ${depth}`;
    const direct = db.prepare(`SELECT COUNT(*) AS cnt FROM catalog_products WHERE ${directWhere}`).get(...pp);

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
    const sortBy  = String(req.query.sort_by  || 'item_name');
    const sortDir = req.query.sort_dir === 'desc' ? 'DESC' : 'ASC';

    const allowedSort = new Set(['item_name','item_code','qty','retail_price','purchase_price','parent_name']);
    const col = allowedSort.has(sortBy) ? sortBy : 'item_name';

    const conditions = [];
    const params = [];

    if (pathParts.length) {
      const { where: pw, params: pp } = catalogPathWhere(pathParts);
      conditions.push(pw);
      params.push(...pp);
    }
    if (q) {
      conditions.push(`(item_name LIKE ? OR item_code LIKE ? OR barcode = ?)`);
      params.push(`%${q}%`, `%${q}%`, q);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM catalog_products ${where}`).get(...params).cnt;
    const items = db.prepare(`
      SELECT id, item_code, item_name, barcode, qty, reserve,
             retail_price, purchase_price, parent_name, variant,
             group_l0, group_l1, group_l2, group_l3, group_l4,
             group_l5, group_l6, group_l7, group_l8,
             group_depth, group_full_path
      FROM catalog_products
      ${where}
      ORDER BY ${col} ${sortDir}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ items, total, limit, offset, has_more: offset + items.length < total });
  } catch (err) {
    console.error('/api/catalog2/items', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Returns single product detail by id or item_code
app.get('/api/catalog2/item/:code', (req, res) => {
  try {
    const code = req.params.code;
    const row = db.prepare(`SELECT * FROM catalog_products WHERE item_code = ? LIMIT 1`).get(code)
             || db.prepare(`SELECT * FROM catalog_products WHERE id = ? LIMIT 1`).get(code);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sales chart data: aggregated by day / week / month
app.get('/api/catalog2/item/:code/sales', (req, res) => {
  try {
    const code = req.params.code;
    const from = String(req.query.from || '2024-01-01');
    const to   = String(req.query.to   || new Date().toISOString().slice(0, 10));
    const gran = String(req.query.gran || 'month'); // day | week | month

    const groupExpr =
      gran === 'day'  ? `strftime('%Y-%m-%d', sale_date)` :
      gran === 'week' ? `strftime('%G-W%V',   sale_date)` :
                        `strftime('%Y-%m',    sale_date)`;

    const rows = db.prepare(`
      SELECT ${groupExpr} AS period,
             SUM(sales_qty)  AS sales,
             SUM(return_qty) AS returns
      FROM catalog_sales
      WHERE item_code = ? AND sale_date >= ? AND sale_date <= ?
      GROUP BY period
      ORDER BY period ASC
    `).all(code, from, to);

    res.json({ series: rows, has_data: rows.length > 0, gran });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import sales records (batch insert)
app.post('/api/catalog2/sales', (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'body must be array' });
    const insert = db.prepare(`
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
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  }
}));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = Number(process.env.PORT || 8787);
app.listen(port, '0.0.0.0', () => {
  console.log(`inventory-manager-web listening on ${port}`);
  console.log(`db: ${dbPath}`);
});
