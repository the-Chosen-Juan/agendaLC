const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'agenda.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// Initialize settings with default password "agenda2026"
function getSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    const hash = bcrypt.hashSync('agenda2026', 10);
    const settings = { passwordHash: hash, teamMembers: [], clients: [], supervisors: [], owners: [] };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return settings;
  }
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Session tokens (in-memory for simplicity)
const sessions = new Map();

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- AUTH ROUTES ---
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const settings = getSettings();
  if (bcrypt.compareSync(password, settings.passwordHash)) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { loggedIn: true, createdAt: Date.now() });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.post('/api/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const settings = getSettings();
  if (!bcrypt.compareSync(currentPassword, settings.passwordHash)) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }
  settings.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveSettings(settings);
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  sessions.delete(token);
  res.json({ success: true });
});

// --- DATA ROUTES ---
function getData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
    return { tasks: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get all tasks
app.get('/api/tasks', authMiddleware, (req, res) => {
  const data = getData();
  res.json(data.tasks);
});

// Create task
app.post('/api/tasks', authMiddleware, (req, res) => {
  const data = getData();
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.tasks.push(task);
  saveData(data);
  res.json(task);
});

// Update task
app.put('/api/tasks/:id', authMiddleware, (req, res) => {
  const data = getData();
  const idx = data.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  data.tasks[idx] = { ...data.tasks[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveData(data);
  res.json(data.tasks[idx]);
});

// Delete task
app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
  const data = getData();
  data.tasks = data.tasks.filter(t => t.id !== req.params.id);
  saveData(data);
  res.json({ success: true });
});

// --- SETTINGS ROUTES (team members, clients, etc.) ---
app.get('/api/settings', authMiddleware, (req, res) => {
  const settings = getSettings();
  res.json({
    teamMembers: settings.teamMembers || [],
    clients: settings.clients || [],
    supervisors: settings.supervisors || [],
    owners: settings.owners || []
  });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const settings = getSettings();
  if (req.body.teamMembers) settings.teamMembers = req.body.teamMembers;
  if (req.body.clients) settings.clients = req.body.clients;
  if (req.body.supervisors) settings.supervisors = req.body.supervisors;
  if (req.body.owners) settings.owners = req.body.owners;
  saveSettings(settings);
  res.json({
    teamMembers: settings.teamMembers,
    clients: settings.clients,
    supervisors: settings.supervisors,
    owners: settings.owners
  });
});

app.listen(PORT, () => {
  console.log(`Agenda LC running on http://localhost:${PORT}`);
});
