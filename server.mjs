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
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
db.prepare("DELETE FROM purchase_order_batches WHERE is_draft = 1").run();

app.get('/api/suppliers', (_req, res) => {
  const rows = db.prepare(`
    SELECT supplier_name, COUNT(*) AS items_count, ROUND(SUM(to_order), 2) AS total_to_order,
           MAX(coverage_days) AS coverage_days
    FROM purchase_recommendations
    WHERE calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
      AND to_order > 0
    GROUP BY supplier_name
    ORDER BY total_to_order DESC
  `).all();
  res.json(rows);
});

app.get('/api/recommendations', (req, res) => {
  const supplier = String(req.query.supplier || '');
  const rows = db.prepare(`
    SELECT id, supplier_name, sku_name, item_ref, norm_name, available_qty, to_order, recommended_stock,
           demand_mode, coverage_days, coverage_source, system_note
    FROM purchase_recommendations
    WHERE calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
      AND supplier_name = ?
      AND to_order > 0
    ORDER BY to_order DESC, sku_name ASC
  `).all(supplier);
  res.json(rows);
});

app.get('/api/search', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  if (q === '%%') return res.json([]);
  const rows = db.prepare(`
    SELECT id, supplier_name, sku_name, item_ref, norm_name, available_qty, to_order, recommended_stock,
           demand_mode, coverage_days, coverage_source, system_note
    FROM purchase_recommendations
    WHERE calc_date = (SELECT MAX(calc_date) FROM purchase_recommendations)
      AND (sku_name LIKE ? OR norm_name LIKE ? OR item_ref LIKE ?)
    ORDER BY to_order DESC, sku_name ASC
    LIMIT 30
  `).all(q, q, q);
  res.json(rows);
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
    SELECT id, supplier_name, status, created_at, draft_mode,
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

const distDir = path.resolve(__dirname, 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

const port = Number(process.env.PORT || 8787);
app.listen(port, '0.0.0.0', () => {
  console.log(`inventory-manager-web listening on ${port}`);
  console.log(`db: ${dbPath}`);
});
