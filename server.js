const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_PASSWORD = process.env.AGENDA_PASSWORD || 'agenda2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STORAGE LAYER - Redis (Vercel) or File (local)
// ============================================================
const USE_REDIS = !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
let redis = null;

if (USE_REDIS) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('Storage: Upstash Redis');
} else {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Storage: Local files (' + DATA_DIR + ')');
}

// --- Storage functions ---
async function getSettings() {
  if (USE_REDIS) {
    const data = await redis.get('agenda:settings');
    if (data) return typeof data === 'string' ? JSON.parse(data) : data;
    // Initialize with defaults
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    const settings = { passwordHash: hash, teamMembers: [], clients: [], supervisors: [], owners: [] };
    await redis.set('agenda:settings', JSON.stringify(settings));
    return settings;
  } else {
    const filePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'settings.json');
    if (!fs.existsSync(filePath)) {
      const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
      const settings = { passwordHash: hash, teamMembers: [], clients: [], supervisors: [], owners: [] };
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
      return settings;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
}

async function saveSettings(settings) {
  if (USE_REDIS) {
    await redis.set('agenda:settings', JSON.stringify(settings));
  } else {
    const filePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'settings.json');
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  }
}

async function getTasks() {
  if (USE_REDIS) {
    const data = await redis.get('agenda:tasks');
    if (data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      return Array.isArray(parsed) ? parsed : parsed.tasks || [];
    }
    return [];
  } else {
    const filePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'agenda.json');
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ tasks: [] }, null, 2));
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return raw.tasks || [];
  }
}

async function saveTasks(tasks) {
  if (USE_REDIS) {
    await redis.set('agenda:tasks', JSON.stringify(tasks));
  } else {
    const filePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'agenda.json');
    fs.writeFileSync(filePath, JSON.stringify({ tasks }, null, 2));
  }
}

// ============================================================
// AUTH - Stateless HMAC tokens (works on serverless)
// ============================================================
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'agenda-lc-secret-key-2026';

function createToken(passwordHash) {
  // Token = timestamp.hmac - any instance can verify without shared state
  const ts = Date.now().toString(36);
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(passwordHash + ':' + ts)
    .digest('hex').slice(0, 32);
  return ts + '.' + hmac;
}

async function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [ts, hmac] = token.split('.');
  const settings = await getSettings();
  const expected = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(settings.passwordHash + ':' + ts)
    .digest('hex').slice(0, 32);
  return hmac === expected;
}

async function authMiddleware(req, res, next) {
  next();
}

app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;
    const settings = await getSettings();
    if (bcrypt.compareSync(password, settings.passwordHash)) {
      const token = createToken(settings.passwordHash);
      return res.json({ token });
    }
    res.status(401).json({ error: 'Contraseña incorrecta' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const settings = await getSettings();
    if (!bcrypt.compareSync(currentPassword, settings.passwordHash)) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    settings.passwordHash = bcrypt.hashSync(newPassword, 10);
    await saveSettings(settings);
    // Return new token since password changed (old tokens auto-invalidate)
    const token = createToken(settings.passwordHash);
    res.json({ success: true, token });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  // Stateless - client just deletes the token
  res.json({ success: true });
});

// ============================================================
// TASKS CRUD
// ============================================================
app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await getTasks();
    res.json(tasks);
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await getTasks();
    const task = {
      id: crypto.randomUUID(),
      client: req.body.client || '',
      taskNumber: req.body.taskNumber || null,
      project: req.body.project || '',
      assignee: req.body.assignee || '',
      supervisor: req.body.supervisor || '',
      priority: req.body.priority || '',
      deadline: req.body.deadline || '',
      status: req.body.status || 'sin empezar',
      owner: req.body.owner || '',
      comments: req.body.comments || '',
      isSupervision: req.body.isSupervision || false,
      isTimeOff: req.body.isTimeOff || false,
      timeOffStart: req.body.timeOffStart || '',
      timeOffEnd: req.body.timeOffEnd || '',
      timeOffType: req.body.timeOffType || '',
      timeOffTitle: req.body.timeOffTitle || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    tasks.push(task);
    await saveTasks(tasks);
    res.json(task);
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const tasks = await getTasks();
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    tasks[idx] = { ...tasks[idx], ...req.body, updatedAt: new Date().toISOString() };
    await saveTasks(tasks);
    res.json(tasks[idx]);
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    let tasks = await getTasks();
    tasks = tasks.filter(t => t.id !== req.params.id);
    await saveTasks(tasks);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// SETTINGS (team members, clients)
// ============================================================
app.get('/api/settings', authMiddleware, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      teamMembers: settings.teamMembers || [],
      clients: settings.clients || [],
      supervisors: settings.supervisors || [],
      owners: settings.owners || [],
      assigneeOrder: settings.assigneeOrder || [],
      teamGroups: settings.teamGroups || [],
      weeklyLeader: settings.weeklyLeader || null,
      leaderPool: settings.leaderPool || [],
      leaderHistory: settings.leaderHistory || [],
      autoDeleteDays: settings.autoDeleteDays !== undefined ? settings.autoDeleteDays : 2,
      dataVersion: settings.dataVersion || 0,
      sheetSyncUrl: settings.sheetSyncUrl || '',
      sheetSyncEnabled: settings.sheetSyncEnabled || false,
      sheetSyncIntervalSec: settings.sheetSyncIntervalSec || 30,
      sheetSyncLastRun: settings.sheetSyncLastRun || null,
      sheetSyncLastResult: settings.sheetSyncLastResult || null,
      hiddenAssignees: settings.hiddenAssignees || []
    });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  try {
    const settings = await getSettings();
    if (req.body.teamMembers) settings.teamMembers = req.body.teamMembers;
    if (req.body.clients) settings.clients = req.body.clients;
    if (req.body.supervisors) settings.supervisors = req.body.supervisors;
    if (req.body.owners) settings.owners = req.body.owners;
    if (req.body.assigneeOrder !== undefined) settings.assigneeOrder = req.body.assigneeOrder;
    if (req.body.teamGroups !== undefined) settings.teamGroups = req.body.teamGroups;
    if (req.body.weeklyLeader !== undefined) settings.weeklyLeader = req.body.weeklyLeader;
    if (req.body.leaderPool !== undefined) settings.leaderPool = req.body.leaderPool;
    if (req.body.leaderHistory !== undefined) settings.leaderHistory = req.body.leaderHistory;
    if (req.body.autoDeleteDays !== undefined) settings.autoDeleteDays = req.body.autoDeleteDays;
    if (req.body.sheetSyncUrl !== undefined) settings.sheetSyncUrl = req.body.sheetSyncUrl;
    if (req.body.sheetSyncEnabled !== undefined) settings.sheetSyncEnabled = req.body.sheetSyncEnabled;
    if (req.body.sheetSyncIntervalSec !== undefined) settings.sheetSyncIntervalSec = req.body.sheetSyncIntervalSec;
    if (req.body.hiddenAssignees !== undefined) settings.hiddenAssignees = req.body.hiddenAssignees;
    await saveSettings(settings);
    res.json({
      teamMembers: settings.teamMembers,
      clients: settings.clients,
      supervisors: settings.supervisors,
      owners: settings.owners,
      assigneeOrder: settings.assigneeOrder || [],
      teamGroups: settings.teamGroups || [],
      weeklyLeader: settings.weeklyLeader || null,
      leaderPool: settings.leaderPool || [],
      leaderHistory: settings.leaderHistory || [],
      autoDeleteDays: settings.autoDeleteDays !== undefined ? settings.autoDeleteDays : 2,
      dataVersion: settings.dataVersion || 0,
      sheetSyncUrl: settings.sheetSyncUrl || '',
      sheetSyncEnabled: settings.sheetSyncEnabled || false,
      sheetSyncIntervalSec: settings.sheetSyncIntervalSec || 30,
      sheetSyncLastRun: settings.sheetSyncLastRun || null,
      sheetSyncLastResult: settings.sheetSyncLastResult || null,
      hiddenAssignees: settings.hiddenAssignees || []
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// PRESENCE - lightweight polling for real-time cell editing
// ============================================================
const presenceStore = {};

app.post('/api/presence', authMiddleware, (req, res) => {
  const { sessionId, taskId, field } = req.body;
  if (!sessionId) return res.json({ ok: true });
  if (taskId && field) {
    presenceStore[sessionId] = { taskId, field, ts: Date.now() };
  } else {
    delete presenceStore[sessionId];
  }
  res.json({ ok: true });
});

app.get('/api/presence', authMiddleware, (req, res) => {
  const exclude = req.query.exclude;
  const now = Date.now();
  // Auto-cleanup stale entries (>10s)
  for (const id of Object.keys(presenceStore)) {
    if (now - presenceStore[id].ts > 10000) delete presenceStore[id];
  }
  const result = Object.entries(presenceStore)
    .filter(([id]) => id !== exclude)
    .map(([, data]) => ({ taskId: data.taskId, field: data.field }));
  res.json(result);
});

// ============================================================
// GOOGLE SHEETS PROXY - fetch public sheet as CSV
// ============================================================
function fetchUrl(targetUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const mod = targetUrl.startsWith('https') ? require('https') : require('http');
    const parsed = new URL(targetUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgendaLC/1.0)',
        'Accept': 'text/csv,text/plain,*/*'
      }
    };
    mod.get(options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchUrl(response.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
      response.on('error', reject);
    }).on('error', reject);
  });
}

app.get('/api/fetch-sheet', authMiddleware, async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return res.status(400).json({ error: 'URL de Google Sheets no válida' });

  const sheetId = match[1];
  // Support gid parameter for specific sheet tabs
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

  try {
    let csv;
    try {
      csv = await fetchUrl(csvUrl);
    } catch {
      // Fallback: gviz endpoint works better for some public sheets
      csv = await fetchUrl(gvizUrl);
    }
    // Detect if Google returned an HTML page instead of CSV
    if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
      // Try the gviz fallback
      csv = await fetchUrl(gvizUrl);
      if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
        throw new Error('Google returned HTML instead of CSV');
      }
    }
    res.json({ csv });
  } catch (err) {
    console.error('Fetch sheet error:', err);
    res.status(500).json({ error: 'No se pudo obtener el documento. Verificá que el link sea público y que tenga permisos de \"Cualquier persona con el enlace\".' });
  }
});

// ============================================================
// SEED ENDPOINT - to populate Redis from initial data
// ============================================================
app.post('/api/seed', async (req, res) => {
  try {
    if (USE_REDIS) {
      // Only seed if the database is completely empty - never overwrite live data
      const existing = await getTasks();
      if (existing.length > 0) {
        return res.json({ message: 'Data already exists, skipping seed', tasks: existing.length });
      }
      // Read seed data from bundled files (first deployment only)
      const seedDataPath = path.join(__dirname, 'data', 'agenda.json');
      const seedSettingsPath = path.join(__dirname, 'data', 'settings.json');
      if (fs.existsSync(seedDataPath)) {
        const data = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));
        await saveTasks(data.tasks || data);
      }
      if (fs.existsSync(seedSettingsPath)) {
        const settingsData = JSON.parse(fs.readFileSync(seedSettingsPath, 'utf-8'));
        await saveSettings(settingsData);
      }
      const newTasks = await getTasks();
      return res.json({ message: 'Seeded successfully', tasks: newTasks.length });
    }
    const currentTasks = await getTasks();
    res.json({ message: 'File storage', tasks: currentTasks.length });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: 'Seed failed' });
  }
});

// ============================================================
// ACTIVITY LOG
// ============================================================
async function getActivityLog() {
  if (USE_REDIS) {
    const data = await redis.get('agenda:activitylog');
    if (data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } else {
    const filePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'activitylog.json');
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
}

async function saveActivityLog(log) {
  // Keep only the last 500 entries
  const trimmed = log.slice(-500);
  if (USE_REDIS) {
    await redis.set('agenda:activitylog', JSON.stringify(trimmed));
  } else {
    const filePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'activitylog.json');
    fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2));
  }
}

app.get('/api/activity-log', authMiddleware, async (req, res) => {
  try {
    const log = await getActivityLog();
    res.json(log);
  } catch (err) {
    console.error('Get activity log error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/activity-log', authMiddleware, async (req, res) => {
  try {
    const log = await getActivityLog();
    const entry = {
      id: crypto.randomUUID(),
      action: req.body.action || 'update',
      taskId: req.body.taskId || '',
      field: req.body.field || '',
      oldValue: req.body.oldValue || '',
      newValue: req.body.newValue || '',
      taskInfo: req.body.taskInfo || '',
      timestamp: new Date().toISOString()
    };
    log.push(entry);
    await saveActivityLog(log);
    res.json(entry);
  } catch (err) {
    console.error('Log activity error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GOOGLE SHEETS AUTO-SYNC
// ============================================================

// Server-side CSV parser
// Name aliases: different spellings in the sheet that should map to the canonical name
const NAME_ALIASES = {
  'mel': 'Mel',
  'meli': 'Mel',
  'tomi': 'Tomy',
  'tomy': 'Tomy',
};

function normalizeAssigneeName(name) {
  if (!name) return name;
  const lower = name.trim().toLowerCase();
  return NAME_ALIASES[lower] || name.trim();
}

function parseCSVServer(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const parseRow = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]).map(h => h.replace(/^"|"$/g, '').toLowerCase().trim());

  // Exact match map — includes the actual Google Sheet column names
  const exactMap = {
    // taskNumber
    '#': 'taskNumber', 'numero': 'taskNumber', 'number': 'taskNumber', 'nro': 'taskNumber',
    'nº': 'taskNumber', 'n°': 'taskNumber', 'no.': 'taskNumber', 'orden': 'taskNumber', 'tr': 'taskNumber',
    // client — "Column 1" is the actual header in the sheet for the client/brand column
    'column 1': 'client', 'cliente': 'client', 'client': 'client', 'marca': 'client', 'marcas': 'client',
    // project
    'proyecto': 'project', 'project': 'project', 'tema': 'project',
    'tema / proyecto': 'project', 'proyecto / tema': 'project',
    'tema/proyecto': 'project', 'tema/ proyecto': 'project',
    // assignee — "Asignado ap" is the actual header in the sheet
    'asignado': 'assignee', 'assignee': 'assignee', 'assigned': 'assignee',
    'asignado a': 'assignee', 'asignado ap': 'assignee', 'responsable': 'assignee',
    // other fields
    'supervisor': 'supervisor',
    'prioridad': 'priority', 'priority': 'priority',
    'deadline': 'deadline', 'fecha': 'deadline', 'fecha limite': 'deadline',
    'fecha límite': 'deadline', 'vencimiento': 'deadline', 'due date': 'deadline',
    'due': 'deadline', 'fecha de entrega': 'deadline',
    'status': 'status', 'estado': 'status', 'estatus': 'status',
    'owner': 'owner', 'dueño': 'owner',
    'comentarios': 'comments', 'comments': 'comments', 'notas': 'comments',
    'observaciones': 'comments', 'nota': 'comments',
    'descripción': 'comments', 'descripcion': 'comments'
  };

  // Partial/contains match as fallback (order matters — first match wins)
  const partialMap = [
    { pattern: 'numer', field: 'taskNumber' },
    { pattern: 'orden', field: 'taskNumber' },
    { pattern: 'column', field: 'client' },
    { pattern: 'client', field: 'client' },
    { pattern: 'marca', field: 'client' },
    { pattern: 'proyect', field: 'project' },
    { pattern: 'tema', field: 'project' },
    { pattern: 'asignad', field: 'assignee' },
    { pattern: 'assign', field: 'assignee' },
    { pattern: 'supervis', field: 'supervisor' },
    { pattern: 'priorid', field: 'priority' },
    { pattern: 'priority', field: 'priority' },
    { pattern: 'deadline', field: 'deadline' },
    { pattern: 'fecha', field: 'deadline' },
    { pattern: 'vencim', field: 'deadline' },
    { pattern: 'status', field: 'status' },
    { pattern: 'estado', field: 'status' },
    { pattern: 'owner', field: 'owner' },
    { pattern: 'dueñ', field: 'owner' },
    { pattern: 'comentar', field: 'comments' },
    { pattern: 'comment', field: 'comments' },
    { pattern: 'nota', field: 'comments' },
    { pattern: 'observ', field: 'comments' },
    { pattern: 'descrip', field: 'comments' },
  ];

  const colMapping = headers.map(h => {
    if (exactMap[h]) return exactMap[h];
    for (const { pattern, field } of partialMap) {
      if (h.includes(pattern)) return field;
    }
    return null;
  });

  console.log('CSV column mapping:', headers.map((h, i) => `"${h}" → ${colMapping[i] || '(unmapped)'}`).join(', '));

  const parsed = [];

  // Section context tracking — the Google Sheet uses z-prefixed section names
  // to push groups to the bottom alphabetically:
  //   "z_esperando respuesta" → tasks here have status "esperando respuesta"
  //   "zz_lider agenda"      → informational section, skip entirely
  //   "zzz_info"             → informational section, skip entirely
  let currentSectionStatus = '';  // status to apply from section context
  let skipCurrentSection = false; // whether to skip all rows in this section

  // Known z-section patterns and what they mean
  const zSectionRules = [
    { pattern: /esperando\s*respuesta/i, status: 'esperando respuesta', skip: false },
    { pattern: /en\s*progreso/i, status: 'en progreso', skip: false },
    { pattern: /sin\s*empezar/i, status: 'sin empezar', skip: false },
    { pattern: /on\s*going/i, status: 'on going', skip: false },
    { pattern: /completado|hecho|terminado/i, status: 'completado', skip: false },
    { pattern: /info/i, status: '', skip: true },
    { pattern: /lider|líder|agenda/i, status: '', skip: true },
  ];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const cleanVals = values.map(v => v.replace(/^"|"$/g, '').trim());

    // Skip section header rows (e.g. "Asignado ap: 1 | Whalys")
    // These have at most 1-2 non-empty cells and contain grouping labels
    const nonEmpty = cleanVals.filter(v => v).length;
    if (nonEmpty <= 2) {
      const joined = cleanVals.join(' ').toLowerCase().trim();

      // Detect z-prefixed section headers (z_, zz_, zzz_)
      if (/^z{1,3}[_\s]/.test(joined)) {
        const sectionName = joined.replace(/^z{1,3}[_\s]+/, '');
        let matched = false;
        for (const rule of zSectionRules) {
          if (rule.pattern.test(sectionName)) {
            currentSectionStatus = rule.status;
            skipCurrentSection = rule.skip;
            matched = true;
            break;
          }
        }
        if (!matched) {
          // Unknown z-section, skip it by default
          currentSectionStatus = '';
          skipCurrentSection = true;
        }
        console.log(`CSV section: "${joined}" → ${skipCurrentSection ? 'SKIP' : `status="${currentSectionStatus}"`}`);
        continue;
      }

      // Detect regular section headers — but check for z-patterns inside
      // e.g. "Asignado ap: 7 | zz_lider agenda" should still trigger z-section skip
      if (joined.match(/asignado|supervisor\s*:|owner\s*:|marca\s*:|prioridad\s*:|status\s*:/i)) {
        const afterPipe = joined.split('|').pop().trim();
        if (/^z{1,3}[_\s]/.test(afterPipe)) {
          const sectionName = afterPipe.replace(/^z{1,3}[_\s]+/, '');
          skipCurrentSection = true; // default for unknown z-sections
          currentSectionStatus = '';
          for (const rule of zSectionRules) {
            if (rule.pattern.test(sectionName)) {
              currentSectionStatus = rule.status;
              skipCurrentSection = rule.skip;
              break;
            }
          }
          console.log(`CSV section (embedded z): "${afterPipe}" → ${skipCurrentSection ? 'SKIP' : `status="${currentSectionStatus}"`}`);
        } else if (/\b(sin\s*asignar|unassigned|abi)\b/i.test(afterPipe)) {
          // Also skip "Sin asignar", "Abi" and similar non-team sections
          skipCurrentSection = true;
          currentSectionStatus = '';
          console.log(`CSV section (ignored assignee): "${afterPipe}" → SKIP`);
        } else {
          currentSectionStatus = '';
          skipCurrentSection = false;
        }
        continue;
      }
    }
    // Skip rows that are entirely empty
    if (nonEmpty === 0) continue;

    // Skip all rows in ignored sections (zzz_info, zz_lider agenda, etc.)
    if (skipCurrentSection) continue;

    const task = {
      client: '', project: '', assignee: '', supervisor: '',
      priority: 'TBD', deadline: '', status: 'sin empezar',
      owner: '', comments: '', taskNumber: ''
    };

    colMapping.forEach((field, idx) => {
      if (field && cleanVals[idx] !== undefined) {
        let val = cleanVals[idx];
        if (!val) return;

        // Clean dash-only values ("--", "-", "—", "---") → treat as empty
        if (/^[-–—]+$/.test(val.trim())) return;

        if (field === 'deadline') {
          // Normalize DD/MM/YYYY or DD/M/YY → YYYY-MM-DD
          const ddmm = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
          if (ddmm) {
            let year = ddmm[3];
            if (year.length === 2) year = '20' + year;
            val = `${year}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
          }
        }

        // Clean assignee: strip "N | " prefix (e.g. "1 | Whalys" → "Whalys")
        // Also extract the priority number for ordering
        if (field === 'assignee') {
          const m = val.match(/^(\d+)\s*\|\s*(.+)$/);
          if (m) {
            task._assigneePriority = parseInt(m[1], 10);
            val = m[2].trim();
          }
          // Normalize name aliases (e.g. "Meli" → "Mel", "Tomi" → "Tomy")
          val = normalizeAssigneeName(val);
        }

        // Normalize status with common-sense translations
        if (field === 'status') {
          // Strip special chars, emojis, checkmarks for matching
          const lower = val.toLowerCase().trim().replace(/[✓✔️☑✅!*]+/g, '').trim();

          // Exact match first
          const statusMap = {
            'hecho': 'completado',
            'terminado': 'completado',
            'finalizado': 'completado',
            'done': 'completado',
            'completed': 'completado',
            'complete': 'completado',
            'listo': 'completado',
            'cerrado': 'completado',
            'closed': 'completado',
            'en proceso': 'en progreso',
            'in progress': 'en progreso',
            'wip': 'en progreso',
            'working': 'en progreso',
            'pendiente': 'sin empezar',
            'not started': 'sin empezar',
            'nuevo': 'sin empezar',
            'new': 'sin empezar',
            'por hacer': 'sin empezar',
            'to do': 'sin empezar',
            'todo': 'sin empezar',
            'waiting': 'esperando respuesta',
            'esperando': 'esperando respuesta',
            'en espera': 'esperando respuesta',
            'on hold': 'esperando respuesta',
            'ongoing': 'on going',
            'on-going': 'on going',
            'continuo': 'on going',
          };
          if (statusMap[lower]) {
            val = statusMap[lower];
          } else {
            // Partial/contains match as fallback
            const partialStatus = [
              { pattern: /hecho/i, status: 'completado' },
              { pattern: /terminad/i, status: 'completado' },
              { pattern: /finalizad/i, status: 'completado' },
              { pattern: /completad/i, status: 'completado' },
              { pattern: /done/i, status: 'completado' },
              { pattern: /listo/i, status: 'completado' },
              { pattern: /progreso/i, status: 'en progreso' },
              { pattern: /esperando/i, status: 'esperando respuesta' },
            ];
            for (const { pattern, status } of partialStatus) {
              if (pattern.test(lower)) {
                val = status;
                break;
              }
            }
          }
        }

        // Normalize priority translations
        if (field === 'priority') {
          const lower = val.toLowerCase().trim();
          const prioMap = {
            'high': 'alta',
            'medium': 'media',
            'mid': 'media',
            'low': 'baja',
          };
          if (prioMap[lower]) {
            val = prioMap[lower];
          }
        }

        task[field] = val;
      }
    });

    // If client field itself is a z-section label, use it as context and clear it
    const clientLower = (task.client || '').toLowerCase().trim();
    if (/^z{1,3}[_\s]/.test(clientLower)) {
      const sectionName = clientLower.replace(/^z{1,3}[_\s]+/, '');
      for (const rule of zSectionRules) {
        if (rule.pattern.test(sectionName)) {
          if (rule.skip) continue; // skip this entire row
          if (rule.status) task.status = rule.status;
          break;
        }
      }
      task.client = ''; // not a real client
    }

    // Apply section context status if the task has no explicit status set
    // (still using the default "sin empezar")
    if (currentSectionStatus && task.status === 'sin empezar') {
      task.status = currentSectionStatus;
    }

    // Detect "Contrato" rows — match client="Contrato" OR project starting with "Contrato"
    // Projects starting with "Contrato" (e.g. "Contrato 31/03") are contract entries,
    // but tasks merely mentioning it (e.g. "Revisión contrato") are not
    const clientIsContrato = (task.client || '').toLowerCase() === 'contrato';
    const projectStartsWithContrato = /^contrato\b/i.test(task.project || '');
    if (clientIsContrato || projectStartsWithContrato) {
      task._isContrato = true;
      // Extract the deadline from the project text if present (e.g. "Contrato hasta 27/2")
      const contratoDateMatch = (task.project || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
      if (contratoDateMatch && !task.deadline) {
        const day = contratoDateMatch[1].padStart(2, '0');
        const month = contratoDateMatch[2].padStart(2, '0');
        const year = contratoDateMatch[3] ? (contratoDateMatch[3].length === 2 ? '20' + contratoDateMatch[3] : contratoDateMatch[3]) : new Date().getFullYear().toString();
        task.deadline = `${year}-${month}-${day}`;
      }
      // Normalize client to 'Contrato' for consistent dedup
      task.client = 'Contrato';
    }

    // Detect PTO / Vacaciones / OOO / Day Off rows → mark as time-off
    const allText = [task.client, task.project, task.comments].join(' ').toLowerCase();
    const timeOffPatterns = [
      { pattern: /\bpto\b/i, type: 'PTO' },
      { pattern: /\bvacaciones\b/i, type: 'Vacaciones' },
      { pattern: /\bday\s*off\b/i, type: 'Day Off' },
      { pattern: /\booo\b/i, type: 'OOO' },
      { pattern: /\bout\s*of\s*office\b/i, type: 'OOO' },
      { pattern: /\btime\s*off\b/i, type: 'Day Off' },
      { pattern: /\blicencia\b/i, type: 'Day Off' },
      { pattern: /\bferiado\b/i, type: 'Day Off' },
    ];
    let detectedTimeOff = null;
    for (const { pattern, type } of timeOffPatterns) {
      if (pattern.test(allText)) {
        detectedTimeOff = type;
        break;
      }
    }
    if (detectedTimeOff) {
      task._isTimeOff = true;
      task._timeOffType = detectedTimeOff;

      // Use project text as the title (no assignee prefix — it's shown next to the badge)
      const projectText = task.project || task.client || '';
      task._timeOffTitle = projectText;

      // Extract date range from project text (DD/MM or DD/MM/YYYY format)
      // e.g. "Marti PTO 20/2 - 6/3" or "OOO 30/03 al 5/04" → start, end
      const dateRangeMatch = projectText.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:[-–—]|al?|hasta)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
      const singleDateMatch = !dateRangeMatch && projectText.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);

      const parseDDMM = (str) => {
        const parts = str.split('/');
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2] ? (parts[2].length === 2 ? '20' + parts[2] : parts[2]) : new Date().getFullYear().toString();
        return `${year}-${month}-${day}`;
      };

      if (dateRangeMatch) {
        task._timeOffStart = parseDDMM(dateRangeMatch[1]);
        task._timeOffEnd = parseDDMM(dateRangeMatch[2]);
      } else if (singleDateMatch) {
        const d = parseDDMM(singleDateMatch[1]);
        task._timeOffStart = d;
        task._timeOffEnd = d;
      } else {
        // Fallback to deadline
        task._timeOffStart = task.deadline || '';
        task._timeOffEnd = task.deadline || '';
      }
    }

    // Skip tasks with z-prefixed assignees (organizational, not real people)
    const assigneeLower = (task.assignee || '').toLowerCase().trim();
    if (/^z{1,3}[_\s]/.test(assigneeLower)) continue;
    // Skip known non-team / unassigned entries
    if (['sin asignar', 'unassigned', 'abi'].includes(assigneeLower)) continue;

    // Only include rows that have actual task data
    if (task.project || (task.client && task.assignee)) {
      parsed.push(task);
    }
  }

  // Deduplicate — the sheet has multiple "group by" views (Asignado a, Marcas,
  // Supervisor, etc.) that repeat the same tasks. Keep only first occurrence.
  // For contrato/time-off tasks, ignore client in dedup key since it varies by view.
  const seen = new Set();
  const unique = [];
  for (const task of parsed) {
    const clientPart = (task._isContrato || task._isTimeOff) ? '_special_' : (task.client || '').toLowerCase();
    const key = `${clientPart}|${(task.project || '').toLowerCase()}|${(task.assignee || '').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(task);
    }
  }

  console.log(`CSV parsed: ${parsed.length} rows → ${unique.length} unique tasks (${parsed.length - unique.length} duplicates removed)`);
  return unique;
}

// Fetch sheet CSV using existing fetchUrl helper
async function fetchSheetCSV(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Invalid Google Sheets URL');

  const sheetId = match[1];
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

  let csv;
  try {
    csv = await fetchUrl(csvUrl);
  } catch {
    csv = await fetchUrl(gvizUrl);
  }
  if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
    csv = await fetchUrl(gvizUrl);
    if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
      throw new Error('Google returned HTML instead of CSV');
    }
  }
  return csv;
}

// Core sync logic
async function performSheetSync() {
  const settings = await getSettings();
  const url = settings.sheetSyncUrl;
  if (!url) throw new Error('No sheet URL configured');

  const csv = await fetchSheetCSV(url);
  console.log('Sheet CSV first 300 chars:', csv.substring(0, 300));
  const sheetTasks = parseCSVServer(csv);
  console.log(`Sheet parsed: ${sheetTasks.length} tasks from ${csv.split('\n').length} CSV lines`);

  // SAFETY: never wipe existing tasks if the sheet returned 0 rows
  // This prevents data loss from fetch errors, wrong URL, or empty sheets
  if (sheetTasks.length === 0) {
    const lines = csv.split('\n').filter(l => l.trim());
    const firstLine = lines[0] || '(empty)';
    throw new Error(`La hoja no devolvió tareas (${lines.length} líneas CSV). Headers detectados: "${firstLine.substring(0, 200)}"`);
  }

  const allTasks = await getTasks();
  // ALL tasks participate in the sync cycle — the sheet is the source of truth.
  // Contracts and time-off entries from the sheet get recreated on each sync;
  // stale entries (removed from sheet) get properly cleaned up.
  const regularTasks = allTasks;
  const contractTasks = []; // nothing preserved outside the sync cycle

  // Build lookup of existing regular tasks by taskNumber
  const existingByNumber = {};
  regularTasks.forEach(t => {
    if (t.taskNumber) existingByNumber[String(t.taskNumber)] = t;
  });

  // Also build a composite key lookup for tasks without numbers
  const existingByComposite = {};
  regularTasks.forEach(t => {
    const key = `${(t.client || '').toLowerCase()}|${(t.project || '').toLowerCase()}|${(t.assignee || '').toLowerCase()}`;
    if (!existingByComposite[key]) existingByComposite[key] = t;
  });

  // Collect assignee priority numbers from sheet BEFORE the loop cleans them
  const assigneePriorities = {};
  for (const st of sheetTasks) {
    const name = st.assignee;
    const prio = st._assigneePriority;
    if (name && prio != null && (assigneePriorities[name] === undefined || prio < assigneePriorities[name])) {
      assigneePriorities[name] = prio;
    }
  }

  const finalRegular = [];
  const usedIds = new Set();
  let created = 0, updated = 0, unchanged = 0;

  for (const st of sheetTasks) {
    // Try to match: first by taskNumber, then by composite key
    let existing = null;
    if (st.taskNumber) {
      existing = existingByNumber[String(st.taskNumber)];
    }
    if (!existing) {
      const key = `${(st.client || '').toLowerCase()}|${(st.project || '').toLowerCase()}|${(st.assignee || '').toLowerCase()}`;
      existing = existingByComposite[key];
      // Don't reuse a task that was already matched
      if (existing && usedIds.has(existing.id)) existing = null;
    }

    // Extract and clean internal flags before comparing
    const assigneePriority = st._assigneePriority || null;
    delete st._assigneePriority;

    const isContrato = st._isContrato || false;
    delete st._isContrato;

    const isTimeOff = st._isTimeOff || false;
    const timeOffType = st._timeOffType || '';
    const timeOffTitle = st._timeOffTitle || '';
    const timeOffStart = st._timeOffStart || st._timeOffDate || '';
    const timeOffEnd = st._timeOffEnd || st._timeOffDate || '';
    delete st._isTimeOff;
    delete st._timeOffType;
    delete st._timeOffTitle;
    delete st._timeOffDate;
    delete st._timeOffStart;
    delete st._timeOffEnd;

    // client already normalized to 'Contrato' in parser if detected

    if (existing && !usedIds.has(existing.id)) {
      usedIds.add(existing.id);
      // Check if anything changed
      let changed = false;
      const fields = ['client', 'project', 'assignee', 'supervisor', 'priority', 'deadline', 'status', 'owner', 'comments', 'taskNumber'];
      for (const f of fields) {
        if ((st[f] || '') !== (existing[f] || '')) {
          changed = true;
          break;
        }
      }
      // Also check if time-off data changed
      if (isTimeOff !== (existing.isTimeOff || false)) changed = true;
      if (timeOffStart && timeOffStart !== (existing.timeOffStart || '')) changed = true;
      if (timeOffEnd && timeOffEnd !== (existing.timeOffEnd || '')) changed = true;
      if (timeOffTitle && timeOffTitle !== (existing.timeOffTitle || '')) changed = true;
      if (changed) {
        // Update existing task with sheet data, preserve id and timestamps
        // Use sheet's current time-off state (not OR with old) so removed OOO/PTO clears out
        const updatedTask = {
          ...existing,
          ...st,
          isSupervision: existing.isSupervision || false,
          isTimeOff,
          timeOffType: isTimeOff ? timeOffType : '',
          timeOffTitle: isTimeOff ? timeOffTitle : '',
          timeOffStart: isTimeOff ? timeOffStart : '',
          timeOffEnd: isTimeOff ? timeOffEnd : '',
          updatedAt: new Date().toISOString()
        };
        finalRegular.push(updatedTask);
        updated++;
      } else {
        finalRegular.push(existing);
        unchanged++;
      }
    } else {
      // New task from sheet (flags already extracted above)
      const newTask = {
        id: crypto.randomUUID(),
        ...st,
        isSupervision: false,
        isTimeOff,
        timeOffStart,
        timeOffEnd,
        timeOffType,
        timeOffTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      finalRegular.push(newTask);
      created++;
    }
  }

  const deleted = regularTasks.length - (updated + unchanged);
  const finalTasks = [...contractTasks, ...finalRegular];
  await saveTasks(finalTasks);

  // Auto-detect team groups from assignee names in the sheet.
  // Names like "Agus y Pau" or "Juli & Sofi" are split by " y " / " & "
  // and matched against known teamMembers to build teamGroups automatically.
  const hiddenSet = new Set((settings.hiddenAssignees || []).map(n => n.toLowerCase()));
  const activeAssignees = new Set(finalTasks.map(t => t.assignee).filter(a => a && !hiddenSet.has(a.toLowerCase())));
  const teamMemberNames = (settings.teamMembers || []).map(m => m.name);

  // Find the best matching team member for a partial name (e.g. "Agus" → "Agus P.")
  function findMemberMatch(part) {
    const lower = part.toLowerCase().trim();
    if (!lower) return null;

    // Exact match
    const exact = teamMemberNames.find(n => n.toLowerCase() === lower);

    // Word-boundary startsWith: "Agus" matches "Agus P." but not "Agustina"
    // This catches cases where compound names abbreviate (e.g. "Agus" in "Agus y Pau" → "Agus P.")
    const wordStartsWith = teamMemberNames.find(n => {
      const nl = n.toLowerCase();
      return nl !== lower && (nl.startsWith(lower + ' ') || nl.startsWith(lower + '.'));
    });

    // Prefer word-boundary startsWith (longer form of same name) over exact
    // e.g. "Agus" → prefer "Agus P." (team member) over "Agus" (owner)
    if (wordStartsWith) return wordStartsWith;
    if (exact) return exact;

    // General startsWith (member name starts with part)
    const startsWith = teamMemberNames.find(n =>
      n.toLowerCase().startsWith(lower) && n.toLowerCase() !== lower
    );
    if (startsWith) return startsWith;

    return null;
  }

  const detectedGroups = [];
  for (const assigneeName of activeAssignees) {
    // Check if name contains " y " or " & " (team separator)
    const separatorMatch = assigneeName.match(/^(.+?)\s+(?:y|&)\s+(.+)$/i);
    if (!separatorMatch) continue;

    const parts = [separatorMatch[1].trim(), separatorMatch[2].trim()];
    const matchedMembers = parts.map(p => findMemberMatch(p)).filter(Boolean);

    // Only create a group if ALL parts matched known members
    if (matchedMembers.length === parts.length && matchedMembers.length >= 2) {
      // Use color from the first matched member
      const firstMember = (settings.teamMembers || []).find(m => m.name === matchedMembers[0]);
      // Check if there's an existing group with this name to preserve its color
      const existingGroup = (settings.teamGroups || []).find(g => g.name === assigneeName);
      detectedGroups.push({
        name: assigneeName,
        color: existingGroup?.color || firstMember?.color || '#6366f1',
        members: matchedMembers
      });
    }
  }

  // Replace teamGroups with auto-detected ones
  settings.teamGroups = detectedGroups;

  // Update team property on members: set for grouped members, clear for ungrouped
  const memberToGroup = new Map();
  for (const group of detectedGroups) {
    for (const memberName of group.members) {
      memberToGroup.set(memberName, group.name);
    }
  }
  for (const member of (settings.teamMembers || [])) {
    if (memberToGroup.has(member.name)) {
      member.team = memberToGroup.get(member.name);
    } else {
      delete member.team;
    }
  }

  // Build assigneeOrder from Google Sheet priority numbers (the "N | Name" format)
  // This respects the exact order defined in the sheet
  // Only include assignees that are registered as team members
  const knownMembers = new Set(teamMemberNames);
  const knownTeamGroupNames = new Set(detectedGroups.map(tg => tg.name));
  detectedGroups.forEach(tg => (tg.members || []).forEach(m => knownMembers.add(m)));

  if (Object.keys(assigneePriorities).length > 0) {
    const orderedBySheet = Object.entries(assigneePriorities)
      .filter(([name]) => activeAssignees.has(name) && (knownMembers.has(name) || knownTeamGroupNames.has(name)))
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);
    // Add any known active assignees that didn't have a priority number at the end
    activeAssignees.forEach(name => {
      if (!orderedBySheet.includes(name) && (knownMembers.has(name) || knownTeamGroupNames.has(name))) orderedBySheet.push(name);
    });
    settings.assigneeOrder = orderedBySheet;
  } else {
    // Fallback: just clean up the existing order
    if (settings.assigneeOrder) {
      settings.assigneeOrder = settings.assigneeOrder.filter(name => activeAssignees.has(name));
    }
  }

  // Auto-discover team members from the sheet: any assignee with a priority number
  // (from "N | Name" format) is a real team member and should be in teamMembers.
  // This ensures members are auto-added when they appear in the sheet and removed
  // when they disappear — no manual settings management needed.
  const existingMemberNames = new Set((settings.teamMembers || []).map(m => m.name));
  const TEAM_COLORS = [
    '#6366f1', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#60a5fa',
    '#c084fc', '#06b6d4', '#22d3ee', '#ef4444', '#d946ef', '#f97316',
    '#14b8a6', '#0ea5e9', '#84cc16', '#e11d48', '#8b5cf6', '#a855f7'
  ];

  for (const [name, prio] of Object.entries(assigneePriorities)) {
    if (existingMemberNames.has(name)) continue;
    // Don't add hidden assignees
    if (hiddenSet.has(name.toLowerCase())) continue;
    // Don't add team group names as individual members
    if (detectedGroups.some(g => g.name === name)) continue;
    // Don't add compound names with "y" / "&" separators as individual members
    // These are team pair names (e.g. "Juli y Sofi") not real individual members
    if (/\s+(?:y|&)\s+/i.test(name)) continue;
    // Auto-add with a color based on their position
    const colorIdx = (settings.teamMembers || []).length % TEAM_COLORS.length;
    if (!settings.teamMembers) settings.teamMembers = [];
    settings.teamMembers.push({
      name,
      color: TEAM_COLORS[colorIdx],
      role: 'Equipo'
    });
    existingMemberNames.add(name);
  }

  // Remove members who no longer have active tasks in the sheet or are hidden
  if (settings.teamMembers) {
    settings.teamMembers = settings.teamMembers.filter(m => activeAssignees.has(m.name) && !hiddenSet.has(m.name.toLowerCase()));
  }

  const result = {
    created,
    updated,
    deleted: Math.max(0, deleted),
    unchanged,
    total: sheetTasks.length,
    timestamp: new Date().toISOString()
  };

  // Save sync status
  settings.sheetSyncLastRun = result.timestamp;
  settings.sheetSyncLastResult = result;
  await saveSettings(settings);

  return result;
}

// Sync endpoint
app.post('/api/sheet-sync', authMiddleware, async (req, res) => {
  try {
    // If URL provided in body, save it first
    if (req.body.url) {
      const settings = await getSettings();
      settings.sheetSyncUrl = req.body.url;
      if (req.body.enabled !== undefined) settings.sheetSyncEnabled = req.body.enabled;
      if (req.body.intervalSec !== undefined) settings.sheetSyncIntervalSec = req.body.intervalSec;
      await saveSettings(settings);
    }

    const result = await performSheetSync();
    console.log(`Sheet sync: +${result.created} ~${result.updated} -${result.deleted} =${result.unchanged}`);
    res.json(result);
  } catch (err) {
    console.error('Sheet sync error:', err.message);
    // Save error status
    try {
      const settings = await getSettings();
      settings.sheetSyncLastRun = new Date().toISOString();
      settings.sheetSyncLastResult = { error: err.message, timestamp: new Date().toISOString() };
      await saveSettings(settings);
    } catch {}
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: see what headers the sheet returns
app.get('/api/sheet-sync/debug', authMiddleware, async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const csv = await fetchSheetCSV(url);
    const lines = csv.split('\n').filter(l => l.trim());
    const parseRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };
    const headers = lines.length > 0 ? parseRow(lines[0]) : [];
    const firstRow = lines.length > 1 ? parseRow(lines[1]) : [];
    const parsed = parseCSVServer(csv);
    res.json({
      totalLines: lines.length,
      headers,
      firstRow,
      parsedTasks: parsed.length,
      sampleTask: parsed[0] || null,
      rawFirst200: csv.substring(0, 500)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detailed CSV structure analysis endpoint
app.get('/api/sheet-sync/debug-structure', authMiddleware, async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const csv = await fetchSheetCSV(url);
    const lines = csv.split('\n');
    const parseRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };

    // Analyze every line
    const analysis = {
      totalLines: lines.length,
      emptyLines: 0,
      headerLines: [],      // lines that look like column headers
      sectionHeaders: [],    // lines that look like section dividers
      dataRows: 0,
      uniqueCol1Values: {},  // all unique values in column 1
      uniqueAssignees: {},   // all unique values in assignee column
      uniqueProjects: {},    // count by project name
      sampleRows: [],        // first 5 data rows per section
      rawLines: []           // first 100 lines for manual inspection
    };

    // Show first 150 raw lines
    for (let i = 0; i < Math.min(150, lines.length); i++) {
      analysis.rawLines.push({ line: i + 1, content: lines[i].substring(0, 300) });
    }

    // Also show lines 200-250 and 400-450 to see repetition
    analysis.rawLines.push({ line: '---', content: '=== LINES 200-230 ===' });
    for (let i = 199; i < Math.min(230, lines.length); i++) {
      analysis.rawLines.push({ line: i + 1, content: lines[i].substring(0, 300) });
    }
    analysis.rawLines.push({ line: '---', content: '=== LINES 400-430 ===' });
    for (let i = 399; i < Math.min(430, lines.length); i++) {
      analysis.rawLines.push({ line: i + 1, content: lines[i].substring(0, 300) });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { analysis.emptyLines++; continue; }

      const cols = parseRow(line);
      const col1 = (cols[0] || '').replace(/^"|"$/g, '').trim();
      const col3 = (cols[2] || '').replace(/^"|"$/g, '').trim();
      const col4 = (cols[3] || '').replace(/^"|"$/g, '').trim();

      // Check if this looks like a header row (contains known header words)
      if (col1.toLowerCase().includes('column') || col3.toLowerCase().includes('tema') || col4.toLowerCase().includes('asignado')) {
        analysis.headerLines.push({ line: i + 1, content: line.substring(0, 200) });
      }

      // Check for section headers (rows where only 1-2 cells are non-empty and contain "Asignado" or assignee pattern)
      const nonEmptyCols = cols.filter(c => c.replace(/^"|"$/g, '').trim()).length;
      if (nonEmptyCols <= 2 && col1 && i > 0) {
        analysis.sectionHeaders.push({ line: i + 1, col1, nonEmptyCols, raw: line.substring(0, 200) });
      }

      // Track unique values
      if (col1) analysis.uniqueCol1Values[col1] = (analysis.uniqueCol1Values[col1] || 0) + 1;
      if (col4) analysis.uniqueAssignees[col4] = (analysis.uniqueAssignees[col4] || 0) + 1;
      if (col3) analysis.uniqueProjects[col3] = (analysis.uniqueProjects[col3] || 0) + 1;
    }

    // Limit project listing to show duplicates
    const projectCounts = Object.entries(analysis.uniqueProjects).sort((a, b) => b[1] - a[1]);
    analysis.topDuplicatedProjects = projectCounts.slice(0, 30);
    analysis.projectsAppearingOnce = projectCounts.filter(([, c]) => c === 1).length;
    analysis.projectsAppearingMultiple = projectCounts.filter(([, c]) => c > 1).length;
    delete analysis.uniqueProjects;

    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore tasks from local seed file (emergency recovery)
app.post('/api/restore-from-seed', authMiddleware, async (req, res) => {
  try {
    const seedPath = path.join(__dirname, 'data', 'agenda.json');
    if (!fs.existsSync(seedPath)) {
      return res.status(404).json({ error: 'No seed file found' });
    }
    const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    const seedTasks = data.tasks || data;
    if (!Array.isArray(seedTasks) || seedTasks.length === 0) {
      return res.status(400).json({ error: 'Seed file has no tasks' });
    }
    await saveTasks(seedTasks);
    res.json({ message: `Restored ${seedTasks.length} tasks from seed`, count: seedTasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync config endpoint
app.put('/api/sheet-sync/config', authMiddleware, async (req, res) => {
  try {
    const settings = await getSettings();
    if (req.body.url !== undefined) settings.sheetSyncUrl = req.body.url;
    if (req.body.enabled !== undefined) settings.sheetSyncEnabled = req.body.enabled;
    if (req.body.intervalSec !== undefined) settings.sheetSyncIntervalSec = req.body.intervalSec;
    await saveSettings(settings);
    res.json({
      sheetSyncUrl: settings.sheetSyncUrl || '',
      sheetSyncEnabled: settings.sheetSyncEnabled || false,
      sheetSyncIntervalSec: settings.sheetSyncIntervalSec || 30,
      sheetSyncLastRun: settings.sheetSyncLastRun || null,
      sheetSyncLastResult: settings.sheetSyncLastResult || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sheet-sync/status', authMiddleware, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      sheetSyncUrl: settings.sheetSyncUrl || '',
      sheetSyncEnabled: settings.sheetSyncEnabled || false,
      sheetSyncIntervalSec: settings.sheetSyncIntervalSec || 30,
      sheetSyncLastRun: settings.sheetSyncLastRun || null,
      sheetSyncLastResult: settings.sheetSyncLastResult || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-sync timer (local server only, not Vercel)
if (process.env.VERCEL !== '1') {
  let syncTimer = null;
  async function startAutoSync() {
    if (syncTimer) clearInterval(syncTimer);
    try {
      const settings = await getSettings();
      if (settings.sheetSyncEnabled && settings.sheetSyncUrl) {
        const interval = (settings.sheetSyncIntervalSec || 30) * 1000;
        syncTimer = setInterval(async () => {
          try {
            const s = await getSettings();
            if (!s.sheetSyncEnabled || !s.sheetSyncUrl) {
              clearInterval(syncTimer);
              syncTimer = null;
              return;
            }
            const result = await performSheetSync();
            if (result.created || result.updated || result.deleted) {
              console.log(`Auto-sync: +${result.created} ~${result.updated} -${result.deleted}`);
            }
          } catch (err) {
            console.error('Auto-sync error:', err.message);
          }
        }, interval);
        console.log(`Sheet auto-sync enabled (every ${settings.sheetSyncIntervalSec || 60}s)`);
      }
    } catch {}
  }
  // Start auto-sync after a short delay to let the server initialize
  setTimeout(startAutoSync, 3000);
  // Re-check config periodically to pick up enable/disable changes
  setInterval(async () => {
    try {
      const s = await getSettings();
      const shouldRun = s.sheetSyncEnabled && s.sheetSyncUrl;
      if (shouldRun && !syncTimer) startAutoSync();
      if (!shouldRun && syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    } catch {}
  }, 15000);
}

// Start server (only when not imported by Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agenda LC running on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = app;
