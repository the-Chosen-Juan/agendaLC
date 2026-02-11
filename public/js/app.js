/* ===========================
   AGENDA LC - App Logic
   =========================== */

// --- STATE ---
let token = localStorage.getItem('agenda_token') || null;
let tasks = [];
let settings = { teamMembers: [], clients: [], supervisors: [], owners: [] };
let currentFilter = { priority: 'all', assignee: '', status: '', client: '', search: '' };
let grouped = true;
let editingTaskId = null;

// Preset colors for avatars
const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#f97316', '#14b8a6',
  '#a855f7', '#e11d48', '#0ea5e9', '#84cc16', '#d946ef'
];

// --- API HELPER ---
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    token = null;
    localStorage.removeItem('agenda_token');
    showLogin();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Server error' }));
    throw new Error(err.error || 'Server error');
  }
  return res.json();
}

// --- TOAST ---
function toast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';
  el.innerHTML = `<span class="material-icons-round">${icon}</span>${escHtml(message)}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// --- LOGIN / LOGOUT ---
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  btn.disabled = true;
  errEl.classList.add('hidden');

  try {
    const data = await api('POST', '/login', { password: pw });
    token = data.token;
    localStorage.setItem('agenda_token', token);
    showApp();
    await loadData();
  } catch {
    errEl.textContent = 'Contraseña incorrecta';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/logout'); } catch {}
  token = null;
  localStorage.removeItem('agenda_token');
  showLogin();
  document.getElementById('login-password').value = '';
});

// --- CHANGE PASSWORD ---
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('password-msg');
  try {
    await api('POST', '/change-password', {
      currentPassword: document.getElementById('current-password').value,
      newPassword: document.getElementById('new-password').value
    });
    msg.textContent = 'Contraseña cambiada correctamente';
    msg.style.color = '#059669';
    msg.classList.remove('hidden');
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    toast('Contraseña actualizada');
  } catch {
    msg.textContent = 'Error al cambiar la contraseña';
    msg.style.color = '#ef4444';
    msg.classList.remove('hidden');
  }
});

// --- NAV ---
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    switchView(view);
    document.getElementById('sidebar').classList.remove('open');
  });
});

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  const titles = { agenda: 'Agenda', team: 'Equipo', settings: 'Configuración' };
  document.getElementById('page-title').textContent = titles[view] || 'Agenda';

  const searchBox = document.getElementById('search-box');
  const addBtn = document.getElementById('add-task-btn');
  if (view === 'agenda') {
    searchBox.classList.remove('hidden');
    addBtn.classList.remove('hidden');
  } else {
    searchBox.classList.add('hidden');
    addBtn.classList.add('hidden');
  }
}

// Sidebar toggle (mobile)
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('sidebar-close').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

// --- DATA LOADING ---
async function loadData() {
  try {
    [tasks, settings] = await Promise.all([
      api('GET', '/tasks'),
      api('GET', '/settings')
    ]);

    // If no tasks, try to seed (for fresh Redis deployments)
    if (tasks.length === 0) {
      try {
        await fetch('/api/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        [tasks, settings] = await Promise.all([
          api('GET', '/tasks'),
          api('GET', '/settings')
        ]);
      } catch {}
    }

    populateFilterDropdowns();
    renderTasks();
    renderTeam();
    updateStats();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// --- POPULATE DROPDOWNS (filters = <select>, form = <datalist>) ---
function populateFilterDropdowns() {
  // Collect all unique values from tasks + settings
  const assignees = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean)
  ])];
  const clients = [...new Set([
    ...(settings.clients || []).map(c => c.name),
    ...tasks.map(t => t.client).filter(Boolean)
  ])];

  // Filter bar selects (these stay as <select> for filtering)
  const assigneeSelect = document.getElementById('filter-assignee');
  const clientSelect = document.getElementById('filter-client');

  assigneeSelect.innerHTML = '<option value="">Todos los asignados</option>';
  clientSelect.innerHTML = '<option value="">Todos los clientes</option>';

  assignees.sort().forEach(a => {
    assigneeSelect.innerHTML += `<option value="${escAttr(a)}">${escHtml(a)}</option>`;
  });

  clients.sort().forEach(c => {
    clientSelect.innerHTML += `<option value="${escAttr(c)}">${escHtml(c)}</option>`;
  });

  // Form datalists (these allow free text + suggestions)
  populateFormDataLists(assignees, clients);
}

function populateFormDataLists(assignees, clients) {
  // All people (from team members + unique names from tasks)
  const allPeople = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean),
    ...tasks.map(t => t.supervisor).filter(Boolean),
    ...tasks.map(t => t.owner).filter(Boolean)
  ])].sort();

  // All clients
  const allClients = [...new Set([
    ...(settings.clients || []).map(c => c.name),
    ...tasks.map(t => t.client).filter(Boolean)
  ])].sort();

  // Populate datalists
  setDatalistOptions('list-assignees', allPeople);
  setDatalistOptions('list-supervisors', allPeople);
  setDatalistOptions('list-owners', allPeople);
  setDatalistOptions('list-clients', allClients);
}

function setDatalistOptions(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = values.map(v => `<option value="${escAttr(v)}">`).join('');
}

// --- RENDER TASKS ---
function renderTasks() {
  const container = document.getElementById('tasks-container');
  const filtered = getFilteredTasks();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons-round">inbox</span>
        <p>No hay tareas que mostrar</p>
      </div>`;
    return;
  }

  if (grouped) {
    renderGroupedTasks(container, filtered);
  } else {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.innerHTML = buildTaskTable(filtered);
    container.appendChild(wrapper);
    bindTaskRows(wrapper);
  }
}

function renderGroupedTasks(container, filtered) {
  const groups = {};
  filtered.forEach(t => {
    const key = t.assignee || 'Sin asignar';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  container.innerHTML = '';

  Object.entries(groups).forEach(([assignee, groupTasks]) => {
    const member = (settings.teamMembers || []).find(m => m.name === assignee);
    const color = member?.color || getColorForName(assignee);
    const initials = getInitials(assignee);

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <div class="group-avatar" style="background:${color}">${initials}</div>
      <span class="group-name">${escHtml(assignee)}</span>
      <span class="group-count">${groupTasks.length} tarea${groupTasks.length !== 1 ? 's' : ''}</span>
      <span class="material-icons-round group-toggle">expand_more</span>
    `;

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    tableWrapper.innerHTML = buildTaskTable(groupTasks);

    header.addEventListener('click', () => {
      const toggle = header.querySelector('.group-toggle');
      toggle.classList.toggle('collapsed');
      tableWrapper.classList.toggle('hidden');
    });

    container.appendChild(header);
    container.appendChild(tableWrapper);
    bindTaskRows(tableWrapper);
  });
}

function buildTaskTable(taskList) {
  let html = `<table class="task-table">
    <thead>
      <tr>
        <th>Cliente</th>
        <th>#</th>
        <th>Tema / Proyecto</th>
        <th>Supervisor</th>
        <th>Prioridad</th>
        <th>Deadline</th>
        <th>Status</th>
        <th>Owner</th>
        <th></th>
      </tr>
    </thead>
    <tbody>`;

  taskList.forEach(t => {
    const clientColor = getClientColor(t.client);
    const priorityClass = (t.priority || '').toLowerCase().replace(' ', '');
    const statusClass = (t.status || '').toLowerCase().replace(/ /g, '-');
    const deadlineClass = getDeadlineClass(t.deadline);
    const hasComment = t.comments && t.comments.trim().length > 0;

    html += `
      <tr data-id="${t.id}">
        <td><span class="client-badge" style="background:${clientColor.bg};color:${clientColor.text}">${escHtml(t.client || '—')}</span></td>
        <td style="color:var(--text-muted);font-size:.8rem">${t.taskNumber || ''}</td>
        <td class="task-project-cell">${escHtml(t.project || '—')}</td>
        <td style="color:var(--text-secondary)">${escHtml(t.supervisor || '—')}</td>
        <td>${t.priority ? `<span class="priority-badge ${priorityClass}">${escHtml(t.priority)}</span>` : '—'}</td>
        <td><span class="deadline-text ${deadlineClass}">${formatDate(t.deadline)}</span></td>
        <td><span class="status-badge ${statusClass}">${escHtml(t.status || '—')}</span></td>
        <td style="color:var(--text-secondary)">${escHtml(t.owner || '—')}</td>
        <td><span class="material-icons-round comment-icon ${hasComment ? 'has-comment' : ''}" title="${escAttr(t.comments || '')}">${hasComment ? 'chat_bubble' : 'chat_bubble_outline'}</span></td>
      </tr>`;
  });

  html += '</tbody></table>';
  return html;
}

function bindTaskRows(wrapper) {
  wrapper.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const task = tasks.find(t => t.id === row.dataset.id);
      if (task) openTaskModal(task);
    });
  });
}

// --- FILTERS ---
document.querySelectorAll('.chip[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter.priority = chip.dataset.filter;
    renderTasks();
    updateStats();
  });
});

document.getElementById('filter-assignee').addEventListener('change', (e) => {
  currentFilter.assignee = e.target.value;
  renderTasks();
  updateStats();
});

document.getElementById('filter-status').addEventListener('change', (e) => {
  currentFilter.status = e.target.value;
  renderTasks();
  updateStats();
});

document.getElementById('filter-client').addEventListener('change', (e) => {
  currentFilter.client = e.target.value;
  renderTasks();
  updateStats();
});

document.getElementById('search-input').addEventListener('input', (e) => {
  currentFilter.search = e.target.value.toLowerCase();
  renderTasks();
  updateStats();
});

document.getElementById('toggle-group').addEventListener('click', () => {
  grouped = !grouped;
  const btn = document.getElementById('toggle-group');
  btn.querySelector('.material-icons-round').textContent = grouped ? 'view_agenda' : 'view_list';
  btn.querySelector('span:last-child').textContent = grouped ? 'Agrupar' : 'Lista';
  renderTasks();
});

function getFilteredTasks() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return tasks.filter(t => {
    if (currentFilter.priority !== 'all' && (t.priority || '').toLowerCase() !== currentFilter.priority) return false;
    if (currentFilter.assignee && t.assignee !== currentFilter.assignee) return false;
    if (currentFilter.status && t.status !== currentFilter.status) return false;
    if (currentFilter.client && t.client !== currentFilter.client) return false;
    if (currentFilter._overdue) {
      if (!t.deadline || t.status === 'completado') return false;
      if (!(new Date(t.deadline) < now)) return false;
    }
    if (currentFilter.search) {
      const s = currentFilter.search;
      const hay = [t.client, t.project, t.assignee, t.supervisor, t.owner, t.comments]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}

// --- STATS (clickable!) ---
function updateStats() {
  const filtered = getFilteredTasks();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  document.getElementById('stat-total').textContent = filtered.length;
  document.getElementById('stat-progress').textContent = filtered.filter(t =>
    t.status === 'en progreso' || t.status === 'on going'
  ).length;
  document.getElementById('stat-notstarted').textContent = filtered.filter(t =>
    t.status === 'sin empezar'
  ).length;
  document.getElementById('stat-overdue').textContent = filtered.filter(t => {
    if (!t.deadline || t.status === 'completado') return false;
    return new Date(t.deadline) < now;
  }).length;
}

// Clickable stat cards - act as quick filters
document.querySelectorAll('.stat-card').forEach(card => {
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => {
    const label = card.querySelector('.stat-label')?.textContent?.trim();
    // Reset all priority chips to "Todas"
    document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
    document.querySelector('.chip[data-filter="all"]').classList.add('active');
    currentFilter.priority = 'all';

    const statusSelect = document.getElementById('filter-status');

    if (label === 'Total') {
      // Clear all filters
      statusSelect.value = '';
      currentFilter.status = '';
      currentFilter.assignee = '';
      currentFilter.client = '';
      document.getElementById('filter-assignee').value = '';
      document.getElementById('filter-client').value = '';
    } else if (label === 'En progreso') {
      statusSelect.value = 'en progreso';
      currentFilter.status = 'en progreso';
    } else if (label === 'Sin empezar') {
      statusSelect.value = 'sin empezar';
      currentFilter.status = 'sin empezar';
    } else if (label === 'Vencidas') {
      // Special: clear status filter, we'll filter overdue in a custom way
      statusSelect.value = '';
      currentFilter.status = '';
      // Use search to find overdue (we'll handle it in rendering)
      currentFilter._overdue = true;
    }

    if (label !== 'Vencidas') {
      currentFilter._overdue = false;
    }

    renderTasks();
    updateStats();
  });
});

// --- TASK MODAL ---
const modal = document.getElementById('task-modal');
const modalClose = document.getElementById('modal-close');
const modalCancel = document.getElementById('modal-cancel');
const modalDelete = document.getElementById('modal-delete');
const taskForm = document.getElementById('task-form');

document.getElementById('add-task-btn').addEventListener('click', () => openTaskModal());

function openTaskModal(task = null) {
  editingTaskId = task ? task.id : null;
  document.getElementById('modal-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  modalDelete.classList.toggle('hidden', !task);

  document.getElementById('task-client').value = task?.client || '';
  document.getElementById('task-project').value = task?.project || '';
  document.getElementById('task-assignee').value = task?.assignee || '';
  document.getElementById('task-supervisor').value = task?.supervisor || '';
  document.getElementById('task-priority').value = task?.priority || '';
  document.getElementById('task-deadline').value = task?.deadline || '';
  document.getElementById('task-status').value = task?.status || 'sin empezar';
  document.getElementById('task-owner').value = task?.owner || '';
  document.getElementById('task-comments').value = task?.comments || '';

  modal.classList.remove('hidden');
}

function closeTaskModal() {
  modal.classList.add('hidden');
  editingTaskId = null;
}

modalClose.addEventListener('click', closeTaskModal);
modalCancel.addEventListener('click', closeTaskModal);
modal.querySelector('.modal-backdrop').addEventListener('click', closeTaskModal);

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const body = {
    client: document.getElementById('task-client').value.trim(),
    project: document.getElementById('task-project').value.trim(),
    assignee: document.getElementById('task-assignee').value.trim(),
    supervisor: document.getElementById('task-supervisor').value.trim(),
    priority: document.getElementById('task-priority').value.trim(),
    deadline: document.getElementById('task-deadline').value,
    status: document.getElementById('task-status').value.trim() || 'sin empezar',
    owner: document.getElementById('task-owner').value.trim(),
    comments: document.getElementById('task-comments').value.trim()
  };

  try {
    if (editingTaskId) {
      await api('PUT', `/tasks/${editingTaskId}`, body);
      toast('Tarea actualizada');
    } else {
      await api('POST', '/tasks', body);
      toast('Tarea creada');
    }
    closeTaskModal();
    await loadData();
  } catch (err) {
    toast('Error al guardar: ' + err.message, 'error');
  }
});

modalDelete.addEventListener('click', async () => {
  if (!editingTaskId) return;
  if (!confirm('¿Eliminar esta tarea?')) return;
  try {
    await api('DELETE', `/tasks/${editingTaskId}`);
    toast('Tarea eliminada');
    closeTaskModal();
    await loadData();
  } catch (err) {
    toast('Error al eliminar: ' + err.message, 'error');
  }
});

// --- TEAM VIEW ---
function renderTeam() {
  const grid = document.getElementById('team-grid');
  const clientsList = document.getElementById('clients-list');

  grid.innerHTML = '';
  (settings.teamMembers || []).forEach(member => {
    const taskCount = tasks.filter(t => t.assignee === member.name).length;
    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-avatar" style="background:${member.color || getColorForName(member.name)}">${getInitials(member.name)}</div>
      <div class="member-info">
        <h3>${escHtml(member.name)}</h3>
        <p>${escHtml(member.role || 'Equipo')}</p>
      </div>
      <span class="member-tasks-count">${taskCount} tarea${taskCount !== 1 ? 's' : ''}</span>
      <button class="member-delete" data-name="${escAttr(member.name)}" title="Eliminar">
        <span class="material-icons-round">close</span>
      </button>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.member-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      if (!confirm(`¿Eliminar a ${name} del equipo?`)) return;
      settings.teamMembers = settings.teamMembers.filter(m => m.name !== name);
      try {
        await api('PUT', '/settings', { teamMembers: settings.teamMembers });
        renderTeam();
        populateFilterDropdowns();
        toast(`${name} eliminado del equipo`);
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    });
  });

  clientsList.innerHTML = '';
  (settings.clients || []).forEach(client => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `
      <span class="client-badge" style="background:${client.color || '#f1f5f9'};color:${client.textColor || '#64748b'}">${escHtml(client.name)}</span>
      <button class="tag-delete" data-name="${escAttr(client.name)}" title="Eliminar">
        <span class="material-icons-round">close</span>
      </button>
    `;
    clientsList.appendChild(tag);
  });

  clientsList.querySelectorAll('.tag-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`¿Eliminar cliente ${name}?`)) return;
      settings.clients = settings.clients.filter(c => c.name !== name);
      try {
        await api('PUT', '/settings', { clients: settings.clients });
        renderTeam();
        populateFilterDropdowns();
        toast(`Cliente ${name} eliminado`);
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    });
  });
}

// --- ADD MEMBER / CLIENT MODALS ---
const promptModal = document.getElementById('prompt-modal');
let promptCallback = null;

function openPromptModal(title, label, showColor, showRole, callback) {
  document.getElementById('prompt-modal-title').textContent = title;
  document.getElementById('prompt-modal-label').textContent = label;
  document.getElementById('prompt-modal-input').value = '';
  document.getElementById('prompt-modal-role').value = '';
  document.getElementById('prompt-modal-color-group').classList.toggle('hidden', !showColor);
  document.getElementById('prompt-modal-role-group').classList.toggle('hidden', !showRole);
  promptCallback = callback;

  if (showColor) {
    const colorsDiv = document.getElementById('prompt-modal-colors');
    colorsDiv.innerHTML = '';
    COLORS.forEach((c, i) => {
      const swatch = document.createElement('div');
      swatch.className = `color-swatch ${i === 0 ? 'selected' : ''}`;
      swatch.style.background = c;
      swatch.dataset.color = c;
      swatch.addEventListener('click', () => {
        colorsDiv.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      });
      colorsDiv.appendChild(swatch);
    });
  }

  promptModal.classList.remove('hidden');
  document.getElementById('prompt-modal-input').focus();
}

function closePromptModal() {
  promptModal.classList.add('hidden');
  promptCallback = null;
}

document.getElementById('prompt-modal-close').addEventListener('click', closePromptModal);
document.getElementById('prompt-modal-cancel').addEventListener('click', closePromptModal);
promptModal.querySelector('.modal-backdrop').addEventListener('click', closePromptModal);

document.getElementById('prompt-modal-save').addEventListener('click', () => {
  const name = document.getElementById('prompt-modal-input').value.trim();
  if (!name) return;
  const selectedColor = document.querySelector('#prompt-modal-colors .color-swatch.selected');
  const color = selectedColor?.dataset.color || COLORS[0];
  const role = document.getElementById('prompt-modal-role').value.trim();
  if (promptCallback) promptCallback({ name, color, role });
  closePromptModal();
});

document.getElementById('add-member-btn').addEventListener('click', () => {
  openPromptModal('Agregar miembro', 'Nombre', true, true, async ({ name, color, role }) => {
    if ((settings.teamMembers || []).some(m => m.name === name)) {
      toast('Ya existe un miembro con ese nombre', 'error');
      return;
    }
    settings.teamMembers = [...(settings.teamMembers || []), { name, color, role }];
    try {
      await api('PUT', '/settings', { teamMembers: settings.teamMembers });
      renderTeam();
      populateFilterDropdowns();
      toast(`${name} agregado al equipo`);
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });
});

document.getElementById('add-client-btn').addEventListener('click', () => {
  openPromptModal('Agregar cliente', 'Nombre del cliente', true, false, async ({ name, color }) => {
    if ((settings.clients || []).some(c => c.name === name)) {
      toast('Ya existe un cliente con ese nombre', 'error');
      return;
    }
    const bg = color + '18';
    settings.clients = [...(settings.clients || []), { name, color: bg, textColor: color }];
    try {
      await api('PUT', '/settings', { clients: settings.clients });
      renderTeam();
      populateFilterDropdowns();
      toast(`Cliente ${name} agregado`);
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });
});

// --- HELPERS ---
function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getColorForName(name) {
  if (!name) return COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

const CLIENT_COLORS = {};
function getClientColor(client) {
  if (!client) return { bg: '#f1f5f9', text: '#64748b' };
  if (CLIENT_COLORS[client]) return CLIENT_COLORS[client];

  const configured = (settings.clients || []).find(c => c.name === client);
  if (configured) {
    CLIENT_COLORS[client] = { bg: configured.color || '#f1f5f9', text: configured.textColor || '#64748b' };
    return CLIENT_COLORS[client];
  }

  const color = getColorForName(client);
  CLIENT_COLORS[client] = { bg: color + '18', text: color };
  return CLIENT_COLORS[client];
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function getDeadlineClass(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'overdue';
  if (diff <= 3) return 'soon';
  return '';
}

// --- KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTaskModal();
    closePromptModal();
  }
});

// --- INIT ---
if (token) {
  showApp();
  loadData();
} else {
  showLogin();
}
