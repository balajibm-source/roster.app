const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'roster.db');

require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    name TEXT,
    stage_name TEXT,
    risk_level TEXT,
    total_followers INTEGER DEFAULT 0,
    avg_er REAL DEFAULT 0,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_risk ON creators(risk_level);
`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '5mb' }));

const PLATFORMS = ["Instagram","TikTok","YouTube","X/Twitter","Twitch","LinkedIn","Pinterest","Threads","Snapchat","Facebook"];

function uid() { return 'c_' + crypto.randomBytes(6).toString('hex'); }

function deriveStats(c) {
  const platforms = Array.isArray(c.platforms) ? c.platforms : [];
  const totalFollowers = platforms.reduce((s, p) => s + (Number(p.followers) || 0), 0);
  const ers = platforms.map(p => Number(p.engagementRate)).filter(v => !isNaN(v) && v > 0);
  const avgEr = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : 0;
  return { totalFollowers, avgEr };
}

function rowToCreator(row) {
  return JSON.parse(row.data);
}

// ---------- List + filter ----------
app.get('/api/creators', (req, res) => {
  const { q, niche, platform, minFollowers, minEr, risk, language, state, minReach90d } = req.query;
  const rows = db.prepare('SELECT * FROM creators ORDER BY updated_at DESC').all();
  let creators = rows.map(rowToCreator);

  if (q) {
    const needle = q.toLowerCase();
    creators = creators.filter(c => {
      const hay = [c.name, c.stageName, ...(c.niches || []), ...(c.platforms || []).map(p => p.handle)]
        .join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  if (language) creators = creators.filter(c => (c.language || '').toLowerCase() === language.toLowerCase());
  if (state) creators = creators.filter(c => (c.state || '').toLowerCase() === state.toLowerCase());
  if (minReach90d) {
    const min = Number(minReach90d);
    creators = creators.filter(c => {
      const total = (c.platforms || []).reduce((s, p) => s + (Number(p.reach90d) || (Number(p.avgMonthlyViews) || 0) * 3), 0);
      return total >= min;
    });
  }
  if (niche) creators = creators.filter(c => (c.niches || []).includes(niche));
  if (platform) creators = creators.filter(c => (c.platforms || []).some(p => p.platform === platform));
  if (minFollowers) {
    const min = Number(minFollowers);
    creators = creators.filter(c => Math.max(0, ...(c.platforms || []).map(p => Number(p.followers) || 0)) >= min);
  }

  if (minEr) {
    const min = Number(minEr);
    creators = creators.filter(c => deriveStats(c).avgEr >= min);
  }
  if (risk) creators = creators.filter(c => c.riskLevel === risk);

  res.json(creators);
});

app.get('/api/creators/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM creators WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(rowToCreator(row));
});

app.post('/api/creators', (req, res) => {
  const c = req.body;
  c.id = c.id && c.id.trim() ? c.id : uid();
  const now = new Date().toISOString();
  const { totalFollowers, avgEr } = deriveStats(c);

  db.prepare(`
    INSERT INTO creators (id, name, stage_name, risk_level, total_followers, avg_er, data, created_at, updated_at)
    VALUES (@id, @name, @stage_name, @risk_level, @total_followers, @avg_er, @data, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, stage_name=excluded.stage_name, risk_level=excluded.risk_level,
      total_followers=excluded.total_followers, avg_er=excluded.avg_er,
      data=excluded.data, updated_at=excluded.updated_at
  `).run({
    id: c.id,
    name: c.name || '',
    stage_name: c.stageName || '',
    risk_level: c.riskLevel || 'low',
    total_followers: totalFollowers,
    avg_er: avgEr,
    data: JSON.stringify(c),
    created_at: c.createdAt || now,
    updated_at: now,
  });

  res.json(c);
});

app.put('/api/creators/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM creators WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const c = { ...req.body, id: req.params.id };
  const now = new Date().toISOString();
  const { totalFollowers, avgEr } = deriveStats(c);

  db.prepare(`
    UPDATE creators SET name=@name, stage_name=@stage_name, risk_level=@risk_level,
      total_followers=@total_followers, avg_er=@avg_er, data=@data, updated_at=@updated_at
    WHERE id=@id
  `).run({
    id: c.id,
    name: c.name || '',
    stage_name: c.stageName || '',
    risk_level: c.riskLevel || 'low',
    total_followers: totalFollowers,
    avg_er: avgEr,
    data: JSON.stringify(c),
    updated_at: now,
  });

  res.json(c);
});

app.delete('/api/creators/:id', (req, res) => {
  db.prepare('DELETE FROM creators WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Stats ----------
app.get('/api/stats', (req, res) => {
  const rows = db.prepare('SELECT * FROM creators').all();
  const creators = rows.map(rowToCreator);
  const totalReach = creators.reduce((s, c) => s + deriveStats(c).totalFollowers, 0);
  const ers = creators.map(c => deriveStats(c).avgEr).filter(v => v > 0);
  const avgEr = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : null;
  const highRisk = creators.filter(c => c.riskLevel === 'high').length;
  res.json({ count: creators.length, totalReach, avgEr, highRisk });
});

// ---------- Languages (for language-first landing view) ----------
app.get('/api/languages', (req, res) => {
  const rows = db.prepare('SELECT * FROM creators').all();
  const creators = rows.map(rowToCreator);
  const counts = {};
  creators.forEach(c => {
    const lang = (c.language || '').trim();
    if (!lang) return;
    if (!counts[lang]) counts[lang] = { language: lang, count: 0, totalReach: 0 };
    counts[lang].count += 1;
    counts[lang].totalReach += deriveStats(c).totalFollowers;
  });
  res.json(Object.values(counts).sort((a, b) => b.count - a.count));
});

// ---------- CSV import/export ----------
const CSV_HEADERS = [
  "name","stageName","country","city","language","niches","contentFormat",
  "platform1","handle1","followers1","er1",
  "platform2","handle2","followers2","er2",
  "contactEmail","contactPhone","agencyName","agencyEmail",
  "riskLevel","blacklistedTopics","paymentTerms","generalNotes"
];

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = [];
      } else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function csvCell(v) {
  v = v == null ? '' : String(v);
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

app.get('/api/csv-template', (req, res) => {
  const sample = 'Jane Doe,janedoe,United States,Austin,English,"Beauty,Skincare",Reels,Instagram,@janedoe,120000,3.4,TikTok,@janedoe,85000,5.1,jane@agency.com,+1 555 0100,Bright Talent Agency,book@brighttalent.com,low,"Alcohol,Politics",Net-30,"Strong DTC conversion history"';
  const csv = CSV_HEADERS.join(',') + '\n' + sample + '\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="roster-template.csv"');
  res.send(csv);
});

app.get('/api/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM creators').all().map(rowToCreator);
  const lines = rows.map(c => {
    const p1 = (c.platforms || [])[0] || {}, p2 = (c.platforms || [])[1] || {};
    return [
      c.name, c.stageName, c.country, c.city, c.language, (c.niches || []).join(';'), c.contentFormat,
      p1.platform || '', p1.handle || '', p1.followers || '', p1.engagementRate || '',
      p2.platform || '', p2.handle || '', p2.followers || '', p2.engagementRate || '',
      c.contactEmail, c.contactPhone, c.agencyName, c.agencyEmail,
      c.riskLevel, c.blacklistedTopics, c.paymentTerms, c.generalNotes
    ].map(csvCell).join(',');
  });
  const csv = CSV_HEADERS.join(',') + '\n' + lines.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="roster-export.csv"');
  res.send(csv);
});

app.post('/api/import', (req, res) => {
  const text = typeof req.body === 'string' ? req.body : '';
  const rows = parseCSV(text);
  if (rows.length < 2) return res.json({ added: 0 });
  const headers = rows[0].map(h => h.trim());
  const now = new Date().toISOString();
  let added = 0;

  const insert = db.prepare(`
    INSERT INTO creators (id, name, stage_name, risk_level, total_followers, avg_er, data, created_at, updated_at)
    VALUES (@id, @name, @stage_name, @risk_level, @total_followers, @avg_er, @data, @created_at, @updated_at)
  `);

  const tx = db.transaction((dataRows) => {
    for (const cells of dataRows) {
      if (cells.every(c => !c || !c.trim())) continue;
      const get = key => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? (cells[idx] || '').trim() : '';
      };
      const name = get('name'), stageName = get('stageName');
      if (!name && !stageName) continue;

      const nicheRaw = get('niches');
      const niches = (nicheRaw.includes(';') ? nicheRaw.split(';') : nicheRaw.split(','))
        .map(s => s.trim()).filter(Boolean);

      const platforms = [];
      [1, 2].forEach(n => {
        const platform = get('platform' + n), handle = get('handle' + n);
        const followers = get('followers' + n), er = get('er' + n);
        if (platform || handle || followers) {
          platforms.push({
            platform: platform || 'Instagram', handle,
            followers: Number(followers) || 0, engagementRate: Number(er) || 0,
            avgViews: 0, rate: 0
          });
        }
      });

      const c = {
        id: uid(), name, stageName, country: get('country'), city: get('city'),
        language: get('language'), niches, contentFormat: get('contentFormat'), platforms,
        contactEmail: get('contactEmail'), contactPhone: get('contactPhone'),
        agencyName: get('agencyName'), agencyEmail: get('agencyEmail'),
        riskLevel: get('riskLevel') || 'low', riskNotes: '', blacklistedTopics: get('blacklistedTopics'),
        paymentMethod: '', currency: '', paymentTerms: get('paymentTerms'),
        avgCTR: '', roas: '', generalNotes: get('generalNotes'),
      };
      const { totalFollowers, avgEr } = deriveStats(c);
      insert.run({
        id: c.id, name: c.name, stage_name: c.stageName, risk_level: c.riskLevel,
        total_followers: totalFollowers, avg_er: avgEr, data: JSON.stringify(c),
        created_at: now, updated_at: now
      });
      added++;
    }
  });
  tx(rows.slice(1));

  res.json({ added });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Roster server running on port ${PORT}`));
