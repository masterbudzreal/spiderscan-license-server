const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3847;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'admin')));

const DB_PATH = path.join(__dirname, 'licenses.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch(e) {}
  return { licenses: [] };
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function generateKey() {
  const segments = [];
  for (let i = 0; i < 5; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return 'SSM-' + segments.join('-');
}

// --- Admin API ---

app.get('/api/licenses', (req, res) => {
  const db = loadDB();
  let licenses = db.licenses;
  const { status, tier, search } = req.query;
  if (status) licenses = licenses.filter(l => l.status === status);
  if (tier) licenses = licenses.filter(l => l.tier === tier);
  if (search) {
    const s = search.toLowerCase();
    licenses = licenses.filter(l =>
      l.license_key.toLowerCase().includes(s) ||
      (l.owner_email || '').toLowerCase().includes(s) ||
      (l.owner_name || '').toLowerCase().includes(s)
    );
  }
  licenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ licenses, total: licenses.length });
});

app.post('/api/licenses', (req, res) => {
  const db = loadDB();
  const { count = 1, tier = 'premium', owner_email, owner_name, expires_at, notes } = req.body;
  const created = [];
  for (let i = 0; i < Math.min(count, 100); i++) {
    const key = generateKey();
    const license = {
      id: db.licenses.length + 1 + i,
      license_key: key,
      tier,
      status: 'active',
      owner_email: owner_email || null,
      owner_name: owner_name || null,
      machine_id: null,
      created_at: new Date().toISOString(),
      activated_at: null,
      expires_at: expires_at || null,
      last_check: null,
      notes: notes || null,
    };
    db.licenses.push(license);
    created.push(key);
  }
  saveDB(db);
  res.json({ created, count: created.length });
});

app.get('/api/licenses/:key', (req, res) => {
  const db = loadDB();
  const row = db.licenses.find(l => l.license_key === req.params.key);
  if (!row) return res.status(404).json({ error: 'License not found' });
  res.json(row);
});

app.patch('/api/licenses/:key', (req, res) => {
  const db = loadDB();
  const idx = db.licenses.findIndex(l => l.license_key === req.params.key);
  if (idx === -1) return res.status(404).json({ error: 'License not found' });
  const row = db.licenses[idx];
  const { status, tier, owner_email, owner_name, machine_id, expires_at, notes } = req.body;
  if (status !== undefined) row.status = status;
  if (tier !== undefined) row.tier = tier;
  if (owner_email !== undefined) row.owner_email = owner_email;
  if (owner_name !== undefined) row.owner_name = owner_name;
  if (machine_id !== undefined) row.machine_id = machine_id;
  if (expires_at !== undefined) row.expires_at = expires_at;
  if (notes !== undefined) row.notes = notes;
  if (status === 'active' && row.activated_at === null) row.activated_at = new Date().toISOString();
  saveDB(db);
  res.json(row);
});

app.delete('/api/licenses/:key', (req, res) => {
  const db = loadDB();
  const idx = db.licenses.findIndex(l => l.license_key === req.params.key);
  if (idx === -1) return res.status(404).json({ error: 'License not found' });
  db.licenses.splice(idx, 1);
  saveDB(db);
  res.json({ deleted: true });
});

// --- Client API (used by the antivirus app) ---

app.post('/api/validate', (req, res) => {
  const { license_key, machine_id } = req.body;
  if (!license_key) return res.status(400).json({ valid: false, error: 'Missing license key' });

  const db = loadDB();
  const row = db.licenses.find(l => l.license_key === license_key);
  if (!row) return res.json({ valid: false, error: 'Invalid license key' });
  if (row.status === 'revoked') return res.json({ valid: false, error: 'License has been revoked' });
  if (row.status === 'expired') return res.json({ valid: false, error: 'License has expired' });
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    row.status = 'expired';
    saveDB(db);
    return res.json({ valid: false, error: 'License has expired' });
  }

  if (machine_id) {
    if (row.machine_id && row.machine_id !== machine_id) {
      return res.json({ valid: false, error: 'License is bound to another machine' });
    }
    if (!row.machine_id) {
      row.machine_id = machine_id;
      row.activated_at = new Date().toISOString();
    }
  }

  row.last_check = new Date().toISOString();
  saveDB(db);

  res.json({
    valid: true,
    tier: row.tier,
    status: row.status,
    expires_at: row.expires_at,
  });
});

app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const ls = db.licenses;
  res.json({
    total: ls.length,
    active: ls.filter(l => l.status === 'active').length,
    revoked: ls.filter(l => l.status === 'revoked').length,
    premium: ls.filter(l => l.tier === 'premium' && l.status === 'active').length,
    free: ls.filter(l => l.tier === 'free' && l.status === 'active').length,
  });
});

app.listen(PORT, () => {
  console.log(`SpiderScan License Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/`);
});
