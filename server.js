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
      weeklyLeader: settings.weeklyLeader || null,
      leaderPool: settings.leaderPool || [],
      autoDeleteDays: settings.autoDeleteDays !== undefined ? settings.autoDeleteDays : 2,
      dataVersion: settings.dataVersion || 0
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
    if (req.body.weeklyLeader !== undefined) settings.weeklyLeader = req.body.weeklyLeader;
    if (req.body.leaderPool !== undefined) settings.leaderPool = req.body.leaderPool;
    if (req.body.autoDeleteDays !== undefined) settings.autoDeleteDays = req.body.autoDeleteDays;
    await saveSettings(settings);
    res.json({
      teamMembers: settings.teamMembers,
      clients: settings.clients,
      supervisors: settings.supervisors,
      owners: settings.owners,
      assigneeOrder: settings.assigneeOrder || [],
      weeklyLeader: settings.weeklyLeader || null,
      leaderPool: settings.leaderPool || [],
      autoDeleteDays: settings.autoDeleteDays !== undefined ? settings.autoDeleteDays : 2,
      dataVersion: settings.dataVersion || 0
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

// Start server (only when not imported by Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agenda LC running on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = app;
