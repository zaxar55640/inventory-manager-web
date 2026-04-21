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

app.get('/api/suppliers', (_req, res) => {
  const rows = db.prepare(`
    SELECT supplier_name, COUNT(*) AS items_count, ROUND(SUM(to_order), 2) AS total_to_order
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

app.get('/api/orders', (_req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.supplier_name, b.status, b.created_at,
           COUNT(i.id) AS items_count,
           ROUND(SUM(COALESCE(i.final_qty, i.manager_qty, i.recommended_qty)), 2) AS total_qty
    FROM purchase_order_batches b
    LEFT JOIN purchase_order_items i ON i.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/orders', (req, res) => {
  const {supplier_name, items} = req.body;
  if (!supplier_name || !Array.isArray(items) || !items.length) {
    return res.status(400).send('supplier_name and items are required');
  }

  const insertBatch = db.prepare('INSERT INTO purchase_order_batches (batch_date, supplier_name, status) VALUES (date(), ?, ?)');
  const insertItem = db.prepare(`
    INSERT INTO purchase_order_items (batch_id, recommendation_id, item_ref, sku_name, norm_name, recommended_qty, manager_qty, final_qty, item_status)
    SELECT ?, r.id, r.item_ref, r.sku_name, r.norm_name, r.to_order, ?, ?, 'draft'
    FROM purchase_recommendations r WHERE r.id = ?
  `);
  const insertDecision = db.prepare(`
    INSERT INTO manager_decisions (decision_date, recommendation_id, supplier_name, store, item_ref, sku_name, norm_name, system_qty, manager_qty, delta_qty, reason, manager_name)
    SELECT date(), r.id, r.supplier_name, r.store, r.item_ref, r.sku_name, r.norm_name, r.to_order, ?, (? - r.to_order), ?, 'manager'
    FROM purchase_recommendations r WHERE r.id = ?
  `);

  const tx = db.transaction(() => {
    const batch = insertBatch.run(supplier_name, 'draft');
    for (const item of items) {
      insertItem.run(batch.lastInsertRowid, item.manager_qty, item.manager_qty, item.recommendation_id);
      insertDecision.run(item.manager_qty, item.manager_qty, item.reason || '', item.recommendation_id);
    }
    return batch.lastInsertRowid;
  });

  const id = tx();
  res.json({ok: true, id});
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
