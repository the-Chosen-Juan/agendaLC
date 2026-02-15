/* ===========================
   AGENDA LC - App Logic
   =========================== */

// --- STATE ---
let token = localStorage.getItem('agenda_token') || null;
let tasks = [];
let settings = { teamMembers: [], clients: [], supervisors: [], owners: [], assigneeOrder: [], weeklyLeader: null };
let currentFilter = { priority: 'all', assignee: '', status: '', client: '', search: '' };
let grouped = true;
let editingTaskId = null;
let editingTimeOffId = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calFilters = { deadlines: true, timeoff: true };
let draggedGroup = null;
let activeEditDropdown = null;
let activeInlineInput = null;
let copyingTaskId = null;

// --- NEW FEATURE STATE ---
const undoStack = [];
const MAX_UNDO = 20;
const sessionId = 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let collapsedGroups = JSON.parse(localStorage.getItem('agenda_collapsed') || '{}');
let presenceData = [];
let presenceInterval = null;
let searchSelectedIdx = -1;

// Preset colors for avatars
const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#f97316', '#14b8a6',
  '#a855f7', '#e11d48', '#0ea5e9', '#84cc16', '#d946ef'
];

const PRIORITY_CYCLE = ['alta', 'media', 'baja', 'TBD'];

const STATUS_OPTIONS = ['sin empezar', 'en progreso', 'on going', 'esperando respuesta', 'completado'];

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

// --- TOAST (supports undo action) ---
function toast(message, type = 'success', action = null) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';
  let html = `<span class="material-icons-round">${icon}</span>${escHtml(message)}`;
  if (action) {
    html += `<button class="undo-btn">${escHtml(action.label)}</button>`;
  }
  el.innerHTML = html;

  if (action) {
    el.querySelector('.undo-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      action.callback();
      el.remove();
    });
  }

  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, action ? 5000 : 3000);
}

// --- DARK MODE ---
const darkModeToggle = document.getElementById('dark-mode-toggle');
if (localStorage.getItem('darkMode') === 'true') {
  document.documentElement.setAttribute('data-theme', 'dark');
  darkModeToggle.querySelector('.material-icons-round').textContent = 'light_mode';
}

darkModeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('darkMode', 'false');
    darkModeToggle.querySelector('.material-icons-round').textContent = 'dark_mode';
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('darkMode', 'true');
    darkModeToggle.querySelector('.material-icons-round').textContent = 'light_mode';
  }
});

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
  stopPresencePolling();
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

  const titles = { agenda: 'Agenda', calendar: 'Calendario', team: 'Equipo', settings: 'Configuración' };
  document.getElementById('page-title').textContent = titles[view] || 'Agenda';

  const searchBox = document.getElementById('search-box');
  const addBtn = document.getElementById('add-task-dropdown');
  if (view === 'agenda') {
    searchBox.classList.remove('hidden');
    addBtn.classList.remove('hidden');
  } else {
    searchBox.classList.add('hidden');
    addBtn.classList.add('hidden');
  }

  if (view === 'calendar') renderCalendar();
}

// Sidebar toggle (mobile)
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('sidebar-close').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

// --- ADD TASK DROPDOWN ---
const addTaskBtn = document.getElementById('add-task-btn');
const addTaskMenu = document.getElementById('add-task-menu');

addTaskBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  addTaskMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  addTaskMenu.classList.add('hidden');
  // Close edit dropdown if clicking outside
  if (activeEditDropdown && !e.target.closest('.edit-dropdown') && !e.target.closest('.editable-cell')) {
    closeEditDropdown();
  }
});

document.getElementById('add-task-regular').addEventListener('click', async () => {
  addTaskMenu.classList.add('hidden');
  try {
    const body = {
      client: '',
      project: '',
      assignee: '',
      supervisor: '',
      priority: 'TBD',
      deadline: '',
      status: 'sin empezar',
      owner: '',
      comments: '',
      isSupervision: false
    };
    const newTask = await api('POST', '/tasks', body);
    await loadData();
    toast('Nueva tarea creada — editá los campos directamente');
    // Auto-focus on the new task's client cell
    setTimeout(() => {
      const row = document.querySelector(`tr[data-id="${newTask.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const clientCell = row.querySelector('[data-field="client"]');
        if (clientCell) clientCell.click();
      }
    }, 100);
  } catch (err) {
    toast('Error al crear tarea: ' + err.message, 'error');
  }
});

document.getElementById('add-timeoff-btn').addEventListener('click', () => {
  addTaskMenu.classList.add('hidden');
  openTimeOffModal();
});

// --- DATA LOADING (with skeleton) ---
function showSkeleton() {
  const container = document.getElementById('tasks-container');
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `<div class="skeleton-row">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton skeleton-cell" style="width:80px"></div>
      <div class="skeleton skeleton-cell" style="flex:1"></div>
      <div class="skeleton skeleton-cell" style="width:100px"></div>
      <div class="skeleton skeleton-cell" style="width:60px"></div>
      <div class="skeleton skeleton-cell" style="width:80px"></div>
    </div>`;
  }
  container.innerHTML = html;
}

async function loadData() {
  try {
    showSkeleton();

    [tasks, settings] = await Promise.all([
      api('GET', '/tasks'),
      api('GET', '/settings')
    ]);

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
    renderLeader();
    updateOverdueBadge();
    startPresencePolling();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// --- POPULATE DROPDOWNS ---
function populateFilterDropdowns() {
  const assignees = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean)
  ])];
  const clients = [...new Set([
    ...(settings.clients || []).map(c => c.name),
    ...tasks.map(t => t.client).filter(Boolean)
  ])];

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

  populateFormDataLists(assignees, clients);
}

function populateFormDataLists(assignees, clients) {
  const allPeople = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean),
    ...tasks.map(t => t.supervisor).filter(Boolean),
    ...tasks.map(t => t.owner).filter(Boolean)
  ])].sort();

  setDatalistOptions('list-to-members', allPeople);
}

function setDatalistOptions(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = values.map(v => `<option value="${escAttr(v)}">`).join('');
}

// --- GET OPTIONS FOR DROPDOWN FIELDS ---
function getOptionsForField(field) {
  const allPeople = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean),
    ...tasks.map(t => t.supervisor).filter(Boolean),
    ...tasks.map(t => t.owner).filter(Boolean)
  ])].sort();

  const allClients = [...new Set([
    ...(settings.clients || []).map(c => c.name),
    ...tasks.map(t => t.client).filter(Boolean)
  ])].sort();

  switch (field) {
    case 'client': return allClients;
    case 'assignee': return allPeople;
    case 'supervisor': return allPeople;
    case 'owner': return allPeople;
    case 'status': return STATUS_OPTIONS;
    case 'priority': return PRIORITY_CYCLE;
    default: return [];
  }
}

// --- RENDER TASKS ---
function getRegularTasks() {
  return tasks.filter(t => !t.isTimeOff);
}

function getTimeOffEntries() {
  return tasks.filter(t => t.isTimeOff);
}

function sortTasksByNumber(taskList) {
  return [...taskList].sort((a, b) => {
    const na = parseInt(a.taskNumber) || 9999;
    const nb = parseInt(b.taskNumber) || 9999;
    return na - nb;
  });
}

function renderTasks() {
  const container = document.getElementById('tasks-container');
  const allFiltered = getFilteredTasks();

  // Separate esperando respuesta tasks
  const esperandoTasks = allFiltered.filter(t => t.status === 'esperando respuesta');
  const regularFiltered = allFiltered.filter(t => t.status !== 'esperando respuesta');

  container.innerHTML = '';

  // Render esperando respuesta section if any
  if (esperandoTasks.length > 0) {
    renderEsperandoSection(container, esperandoTasks);
  }

  if (regularFiltered.length === 0 && esperandoTasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons-round">inbox</span>
        <p>No hay tareas que mostrar</p>
      </div>`;
    return;
  }

  if (grouped) {
    renderGroupedTasks(container, regularFiltered);
  } else {
    const sorted = sortTasksByNumber(regularFiltered);
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.innerHTML = buildTaskTable(sorted);
    container.appendChild(wrapper);
    bindTaskRows(wrapper);

    // Mobile cards
    const cards = buildMobileCards(sorted);
    container.appendChild(cards);
  }
}

function renderEsperandoSection(container, esperandoTasks) {
  const section = document.createElement('div');
  section.className = 'esperando-section';

  const isCollapsed = collapsedGroups['__esperando__'] === true;

  const header = document.createElement('div');
  header.className = 'esperando-header';
  header.innerHTML = `
    <span class="material-icons-round">hourglass_top</span>
    <span class="group-name">Esperando Respuesta</span>
    <span class="group-count">${esperandoTasks.length} tarea${esperandoTasks.length !== 1 ? 's' : ''}</span>
    <span class="material-icons-round group-toggle ${isCollapsed ? 'collapsed' : ''}">expand_more</span>
  `;

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-wrapper';
  if (isCollapsed) tableWrapper.classList.add('hidden');
  const sorted = sortTasksByNumber(esperandoTasks);
  tableWrapper.innerHTML = buildTaskTable(sorted, true);

  // Mobile cards for esperando
  const cards = buildMobileCards(sorted);
  if (isCollapsed) cards.classList.add('hidden');

  header.addEventListener('click', () => {
    const toggle = header.querySelector('.group-toggle');
    toggle.classList.toggle('collapsed');
    tableWrapper.classList.toggle('hidden');
    cards.classList.toggle('hidden');
    collapsedGroups['__esperando__'] = tableWrapper.classList.contains('hidden');
    localStorage.setItem('agenda_collapsed', JSON.stringify(collapsedGroups));
  });

  section.appendChild(header);
  section.appendChild(tableWrapper);
  section.appendChild(cards);
  container.appendChild(section);
  bindTaskRows(tableWrapper);

  // Drag from esperando: rows can be dragged to group headers to reassign
  tableWrapper.querySelectorAll('tr[data-id]').forEach(row => {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', row.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging-task');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging-task');
      document.querySelectorAll('.group-header.drop-target').forEach(h => h.classList.remove('drop-target'));
    });
  });
}

function renderGroupedTasks(container, filtered) {
  const groups = {};
  filtered.forEach(t => {
    const key = t.assignee || 'Sin asignar';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  const order = settings.assigneeOrder || [];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const timeOffs = getTimeOffEntries();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  sortedKeys.forEach((assignee) => {
    const groupTasks = sortTasksByNumber(groups[assignee]);
    const member = (settings.teamMembers || []).find(m => m.name === assignee);
    const color = member?.color || getColorForName(assignee);
    const initials = member?.initials || getInitials(assignee);

    const memberTimeOffs = timeOffs.filter(to => to.assignee === assignee);

    // Count overdue tasks in this group
    const overdueCount = groupTasks.filter(t => {
      if (!t.deadline || t.status === 'completado') return false;
      return new Date(t.deadline + 'T00:00:00') < now;
    }).length;

    const isCollapsed = collapsedGroups[assignee] === true;

    const header = document.createElement('div');
    header.className = 'group-header';
    header.setAttribute('draggable', 'true');
    header.dataset.assignee = assignee;

    let timeoffHtml = '';
    if (memberTimeOffs.length > 0) {
      timeoffHtml = '<div class="group-timeoff">';
      memberTimeOffs.forEach(to => {
        const start = formatDate(to.timeOffStart);
        const end = formatDate(to.timeOffEnd);
        const type = to.timeOffType || 'Time Off';
        timeoffHtml += `<span class="timeoff-badge" data-id="${to.id}" title="${escAttr(type)}">
          <span class="material-icons-round">beach_access</span>
          ${escHtml(type)}: ${start} - ${end}
        </span>`;
      });
      timeoffHtml += '</div>';
    }

    let overdueHtml = '';
    if (overdueCount > 0) {
      overdueHtml = `<span class="group-overdue-icon" title="${overdueCount} vencida${overdueCount > 1 ? 's' : ''}">
        <span class="material-icons-round">warning</span>
      </span>`;
    }

    header.innerHTML = `
      <span class="material-icons-round drag-handle">drag_indicator</span>
      <div class="group-avatar" style="background:${color}">${initials}</div>
      <span class="group-name">${escHtml(assignee)}</span>
      <span class="group-count">${groupTasks.length} tarea${groupTasks.length !== 1 ? 's' : ''}</span>
      ${overdueHtml}
      ${timeoffHtml}
      <span class="material-icons-round group-toggle ${isCollapsed ? 'collapsed' : ''}">expand_more</span>
    `;

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    if (isCollapsed) tableWrapper.classList.add('hidden');
    tableWrapper.innerHTML = buildTaskTable(groupTasks, false, assignee);

    // Mobile cards
    const cards = buildMobileCards(groupTasks, assignee);
    if (isCollapsed) cards.classList.add('hidden');

    // Toggle collapse (with localStorage persistence)
    header.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle') || e.target.closest('.timeoff-badge')) return;
      const toggle = header.querySelector('.group-toggle');
      toggle.classList.toggle('collapsed');
      tableWrapper.classList.toggle('hidden');
      cards.classList.toggle('hidden');
      collapsedGroups[assignee] = tableWrapper.classList.contains('hidden');
      localStorage.setItem('agenda_collapsed', JSON.stringify(collapsedGroups));
    });

    // Time off badge click
    header.querySelectorAll('.timeoff-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const toTask = tasks.find(t => t.id === badge.dataset.id);
        if (toTask) openTimeOffModal(toTask);
      });
    });

    // Group drag and drop for reordering
    header.addEventListener('dragstart', (e) => {
      if (e.target.closest('tr[data-id]')) return;
      draggedGroup = assignee;
      header.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    header.addEventListener('dragend', () => {
      header.classList.remove('dragging');
      container.querySelectorAll('.group-header').forEach(h => {
        h.classList.remove('drag-over');
        h.classList.remove('drop-target');
      });
      draggedGroup = null;
    });

    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedGroup && header.dataset.assignee !== draggedGroup) {
        header.classList.add('drag-over');
      } else if (!draggedGroup) {
        header.classList.add('drop-target');
      }
    });

    header.addEventListener('dragleave', () => {
      header.classList.remove('drag-over');
      header.classList.remove('drop-target');
    });

    header.addEventListener('drop', async (e) => {
      e.preventDefault();
      header.classList.remove('drag-over');
      header.classList.remove('drop-target');

      const taskId = e.dataTransfer.getData('text/plain');

      if (taskId && !draggedGroup) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          try {
            await api('PUT', `/tasks/${taskId}`, { assignee: assignee, status: 'en progreso' });
            task.assignee = assignee;
            task.status = 'en progreso';
            renderTasks();
            updateStats();
            toast(`Tarea movida a ${assignee}`);
          } catch (err) {
            toast('Error al mover tarea', 'error');
          }
        }
        return;
      }

      if (!draggedGroup || draggedGroup === assignee) return;

      const currentHeaders = [...container.querySelectorAll('.group-header')];
      const names = currentHeaders.map(h => h.dataset.assignee);
      const fromIdx = names.indexOf(draggedGroup);
      const toIdx = names.indexOf(assignee);
      if (fromIdx === -1 || toIdx === -1) return;

      names.splice(fromIdx, 1);
      names.splice(toIdx, 0, draggedGroup);

      settings.assigneeOrder = names;
      api('PUT', '/settings', { assigneeOrder: names }).catch(() => {});
      renderTasks();
    });

    container.appendChild(header);
    container.appendChild(tableWrapper);
    container.appendChild(cards);
    bindTaskRows(tableWrapper);
  });
}

function buildTaskTable(taskList, showAssignee = false, groupAssignee = '') {
  let html = `<table class="task-table">
    <thead>
      <tr>
        <th>Cliente</th>
        <th>#</th>
        <th>Tema / Proyecto</th>
        ${showAssignee ? '<th>Asignado</th>' : ''}
        <th>Supervisor</th>
        <th>Prioridad</th>
        <th>Deadline</th>
        <th>Status</th>
        <th>Owner</th>
        <th></th>
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
    const supervisionTag = t.isSupervision
      ? '<span class="supervision-tag"><span class="material-icons-round">visibility</span>Supervisión</span>'
      : '';

    html += `
      <tr data-id="${t.id}">
        <td class="editable-cell" data-field="client"><span class="client-badge" style="background:${clientColor.bg};color:${clientColor.text}">${escHtml(t.client || '—')}</span></td>
        <td style="color:var(--text-muted);font-size:.8rem">${t.taskNumber || ''}</td>
        <td class="editable-cell task-project-cell" data-field="project">${escHtml(t.project || '—')}${supervisionTag}</td>
        ${showAssignee ? `<td class="editable-cell" data-field="assignee" style="color:var(--text-secondary)">${escHtml(t.assignee || '—')}</td>` : ''}
        <td class="editable-cell" data-field="supervisor" style="color:var(--text-secondary)">${escHtml(t.supervisor || '—')}</td>
        <td class="editable-cell" data-field="priority"><span class="priority-badge ${priorityClass}">${escHtml(t.priority || '—')}</span></td>
        <td class="editable-cell" data-field="deadline"><span class="deadline-text ${deadlineClass}">${formatDate(t.deadline)}</span></td>
        <td class="editable-cell" data-field="status"><span class="status-badge ${statusClass}">${escHtml(t.status || '—')}</span></td>
        <td class="editable-cell" data-field="owner" style="color:var(--text-secondary)">${escHtml(t.owner || '—')}</td>
        <td class="editable-cell comment-cell" data-field="comments"><span class="material-icons-round comment-icon ${hasComment ? 'has-comment' : ''}">${hasComment ? 'chat_bubble' : 'chat_bubble_outline'}</span></td>
        <td>
          <div class="task-actions">
            <button class="task-action-btn copy" title="Copiar tarea" data-task-id="${t.id}"><span class="material-icons-round">content_copy</span></button>
            <button class="task-action-btn delete" title="Eliminar tarea" data-task-id="${t.id}"><span class="material-icons-round">delete</span></button>
          </div>
        </td>
      </tr>`;
  });

  // Quick-add row
  const colSpan = showAssignee ? 11 : 10;
  html += `<tr class="quick-add-row" data-group-assignee="${escAttr(groupAssignee)}">
    <td colspan="${colSpan}"><span class="material-icons-round">add</span> Agregar tarea...</td>
  </tr>`;

  html += '</tbody></table>';
  return html;
}

// --- MOBILE CARD VIEW ---
function buildMobileCards(taskList, groupAssignee = '') {
  const container = document.createElement('div');
  container.className = 'mobile-cards';

  taskList.forEach(t => {
    const clientColor = getClientColor(t.client);
    const priorityClass = (t.priority || '').toLowerCase().replace(' ', '');
    const statusClass = (t.status || '').toLowerCase().replace(/ /g, '-');
    const deadlineClass = getDeadlineClass(t.deadline);

    const card = document.createElement('div');
    card.className = 'mobile-task-card';
    card.dataset.id = t.id;

    card.innerHTML = `
      <div class="mobile-card-top">
        <span class="client-badge" style="background:${clientColor.bg};color:${clientColor.text};font-size:.7rem">${escHtml(t.client || '—')}</span>
        <span class="mobile-card-project">${escHtml(t.project || 'Sin proyecto')}</span>
        <span class="priority-badge ${priorityClass}" style="font-size:.65rem">${escHtml(t.priority || '—')}</span>
      </div>
      <div class="mobile-card-bottom">
        <span class="status-badge ${statusClass}" style="font-size:.65rem">${escHtml(t.status || '—')}</span>
        ${t.deadline ? `<span class="mobile-card-meta"><span class="material-icons-round">event</span><span class="deadline-text ${deadlineClass}">${formatDate(t.deadline)}</span></span>` : ''}
        ${t.supervisor ? `<span class="mobile-card-meta"><span class="material-icons-round">person</span>${escHtml(t.supervisor)}</span>` : ''}
        <div class="mobile-card-actions">
          <button class="task-action-btn copy" title="Copiar" data-task-id="${t.id}"><span class="material-icons-round">content_copy</span></button>
          <button class="task-action-btn delete" title="Eliminar" data-task-id="${t.id}"><span class="material-icons-round">delete</span></button>
        </div>
      </div>
    `;

    // Mobile card tap -> open inline editing for project
    card.addEventListener('click', (e) => {
      if (e.target.closest('.task-action-btn')) return;
      switchView('agenda');
      setTimeout(() => {
        const row = document.querySelector(`tr[data-id="${t.id}"]`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const cell = row.querySelector('[data-field="project"]');
          if (cell) cell.click();
        }
      }, 100);
    });

    // Mobile card action buttons
    card.querySelector('.task-action-btn.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar esta tarea?')) return;
      try {
        await api('DELETE', `/tasks/${t.id}`);
        toast('Tarea eliminada');
        await loadData();
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    });

    card.querySelector('.task-action-btn.copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyingTaskId = t.id;
      document.getElementById('copy-assignee').value = '';
      document.getElementById('copy-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('copy-assignee').focus(), 100);
    });

    container.appendChild(card);
  });

  // Quick-add for mobile
  const addCard = document.createElement('div');
  addCard.className = 'mobile-task-card';
  addCard.style.opacity = '.4';
  addCard.style.justifyContent = 'center';
  addCard.style.alignItems = 'center';
  addCard.style.flexDirection = 'row';
  addCard.style.gap = '.5rem';
  addCard.style.color = 'var(--text-muted)';
  addCard.style.fontSize = '.85rem';
  addCard.innerHTML = '<span class="material-icons-round" style="font-size:1rem">add</span> Agregar tarea...';
  addCard.addEventListener('click', () => quickAddTask(groupAssignee));
  container.appendChild(addCard);

  return container;
}

function bindTaskRows(wrapper) {
  // Editable cells click -> inline edit
  wrapper.querySelectorAll('.editable-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = cell.closest('tr[data-id]');
      if (!row) return;
      const taskId = row.dataset.id;
      const field = cell.dataset.field;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      startInlineEdit(cell, task, field);
    });
  });

  // Comment tooltip on hover
  wrapper.querySelectorAll('.comment-cell').forEach(cell => {
    cell.addEventListener('mouseenter', (e) => {
      const row = cell.closest('tr[data-id]');
      if (!row) return;
      const task = tasks.find(t => t.id === row.dataset.id);
      if (task && task.comments && task.comments.trim()) {
        showCommentTooltip(cell, task.comments);
      }
    });
    cell.addEventListener('mouseleave', () => {
      hideCommentTooltip();
    });
  });

  // Task action buttons
  wrapper.querySelectorAll('.task-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      if (!confirm('¿Eliminar esta tarea?')) return;
      try {
        await api('DELETE', `/tasks/${taskId}`);
        toast('Tarea eliminada');
        await loadData();
      } catch (err) {
        toast('Error al eliminar: ' + err.message, 'error');
      }
    });
  });

  wrapper.querySelectorAll('.task-action-btn.copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (!task) { toast('No se encontró la tarea', 'error'); return; }
      copyingTaskId = taskId;
      document.getElementById('copy-assignee').value = '';
      document.getElementById('copy-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('copy-assignee').focus(), 100);
    });
  });

  // Quick-add row
  wrapper.querySelectorAll('.quick-add-row').forEach(row => {
    row.addEventListener('click', () => {
      const assignee = row.dataset.groupAssignee || '';
      quickAddTask(assignee);
    });
  });
}

// --- QUICK ADD TASK ---
async function quickAddTask(assignee) {
  try {
    const body = {
      client: '',
      project: '',
      assignee: assignee,
      supervisor: '',
      priority: 'TBD',
      deadline: '',
      status: 'sin empezar',
      owner: '',
      comments: '',
      isSupervision: false
    };
    const newTask = await api('POST', '/tasks', body);
    await loadData();
    toast('Tarea creada');
    setTimeout(() => {
      const row = document.querySelector(`tr[data-id="${newTask.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const cell = row.querySelector('[data-field="client"]');
        if (cell) cell.click();
      }
    }, 100);
  } catch (err) {
    toast('Error al crear tarea: ' + err.message, 'error');
  }
}

// --- INLINE EDITING ---
function startInlineEdit(cell, task, field) {
  closeEditDropdown();
  closeInlineInput();

  // Report presence
  reportPresence(task.id, field);

  const dropdownFields = ['client', 'assignee', 'supervisor', 'owner', 'status', 'priority'];
  const textFields = ['project', 'comments'];

  if (dropdownFields.includes(field)) {
    openEditDropdown(cell, task, field);
  } else if (field === 'deadline') {
    openDateInput(cell, task);
  } else if (textFields.includes(field)) {
    openTextInput(cell, task, field);
  }
}

function openTextInput(cell, task, field) {
  const currentValue = task[field] || '';
  const rect = cell.getBoundingClientRect();

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-edit-input';
  input.value = currentValue;
  input.placeholder = field === 'comments' ? 'Agregar comentario...' : 'Escribir...';

  const originalHtml = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  activeInlineInput = { cell, originalHtml, input };

  const save = async () => {
    const newValue = input.value.trim();
    if (newValue !== currentValue) {
      try {
        const update = {};
        update[field] = newValue;
        await api('PUT', `/tasks/${task.id}`, update);
        // Push undo
        pushUndo(task.id, field, currentValue, newValue);
        task[field] = newValue;
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }
    closeInlineInput();
    clearPresence();
    renderTasks();
    updateStats();
    // Highlight saved cell
    highlightCell(task.id, field);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { closeInlineInput(); clearPresence(); cell.innerHTML = originalHtml; }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineInput && activeInlineInput.input === input) save();
    }, 150);
  });
}

function openDateInput(cell, task) {
  const currentValue = task.deadline || '';
  const originalHtml = cell.innerHTML;

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'cell-edit-input';
  input.value = currentValue;

  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();

  activeInlineInput = { cell, originalHtml, input };

  const save = async () => {
    const newValue = input.value;
    if (newValue !== currentValue) {
      try {
        await api('PUT', `/tasks/${task.id}`, { deadline: newValue });
        pushUndo(task.id, 'deadline', currentValue, newValue);
        task.deadline = newValue;
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }
    closeInlineInput();
    clearPresence();
    renderTasks();
    updateStats();
    updateOverdueBadge();
    highlightCell(task.id, 'deadline');
  };

  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeInlineInput(); clearPresence(); cell.innerHTML = originalHtml; }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineInput && activeInlineInput.input === input) save();
    }, 150);
  });
}

// --- EDIT DROPDOWN ---
function openEditDropdown(cell, task, field) {
  const dropdown = document.getElementById('edit-dropdown');
  const searchInput = document.getElementById('edit-dropdown-search');
  const optionsContainer = document.getElementById('edit-dropdown-options');
  const addBtn = document.getElementById('edit-dropdown-add');

  const options = getOptionsForField(field);
  const currentValue = task[field] || '';
  const canAdd = ['client', 'assignee', 'supervisor', 'owner'].includes(field);

  // Position dropdown
  const rect = cell.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.minWidth = Math.max(rect.width, 200) + 'px';

  // Adjust if off-screen
  const maxLeft = window.innerWidth - 320;
  if (rect.left > maxLeft) {
    dropdown.style.left = maxLeft + 'px';
  }

  searchInput.value = '';
  searchInput.placeholder = 'Buscar...';
  addBtn.classList.toggle('hidden', !canAdd);

  function renderOptions(filter = '') {
    const filtered = filter
      ? options.filter(o => o.toLowerCase().includes(filter.toLowerCase()))
      : options;

    optionsContainer.innerHTML = '';
    filtered.forEach(opt => {
      const div = document.createElement('div');
      div.className = `edit-dropdown-option ${opt === currentValue ? 'active' : ''}`;
      div.innerHTML = `<span class="option-label">${escHtml(opt)}</span>`;
      div.addEventListener('click', () => {
        selectDropdownOption(task, field, opt, currentValue);
      });
      optionsContainer.appendChild(div);
    });

    if (filtered.length === 0) {
      optionsContainer.innerHTML = '<div style="padding:.75rem;color:var(--text-muted);font-size:.85rem;text-align:center">Sin resultados</div>';
    }
  }

  renderOptions();

  searchInput.oninput = () => renderOptions(searchInput.value);

  addBtn.onclick = () => {
    const newName = searchInput.value.trim();
    if (!newName) {
      toast('Escribí un nombre en el buscador', 'error');
      return;
    }
    selectDropdownOption(task, field, newName, currentValue);
    // Also add to settings if appropriate
    if (field === 'client') {
      const color = getColorForName(newName);
      const bg = color + '18';
      if (!(settings.clients || []).some(c => c.name === newName)) {
        settings.clients = [...(settings.clients || []), { name: newName, color: bg, textColor: color }];
        api('PUT', '/settings', { clients: settings.clients }).catch(() => {});
      }
    } else if (field === 'assignee' || field === 'supervisor' || field === 'owner') {
      if (!(settings.teamMembers || []).some(m => m.name === newName)) {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        settings.teamMembers = [...(settings.teamMembers || []), { name: newName, color, role: '' }];
        api('PUT', '/settings', { teamMembers: settings.teamMembers }).catch(() => {});
      }
    }
  };

  dropdown.classList.remove('hidden');
  searchInput.focus();

  activeEditDropdown = { dropdown, cell, task, field };
}

async function selectDropdownOption(task, field, value, oldValue) {
  closeEditDropdown();
  clearPresence();
  const previousValue = oldValue !== undefined ? oldValue : (task[field] || '');
  try {
    const update = {};
    update[field] = value;
    await api('PUT', `/tasks/${task.id}`, update);
    pushUndo(task.id, field, previousValue, value);
    task[field] = value;
    renderTasks();
    updateStats();
    updateOverdueBadge();
    populateFilterDropdowns();
    highlightCell(task.id, field);

    // Check for completion celebration
    if (field === 'status' && value === 'completado') {
      checkCelebration(task);
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function closeEditDropdown() {
  const dropdown = document.getElementById('edit-dropdown');
  dropdown.classList.add('hidden');
  activeEditDropdown = null;
}

function closeInlineInput() {
  if (activeInlineInput) {
    activeInlineInput = null;
  }
}

// --- COMMENT TOOLTIP ---
function showCommentTooltip(cell, text) {
  const tooltip = document.getElementById('comment-tooltip');
  const rect = cell.getBoundingClientRect();

  tooltip.textContent = text;
  tooltip.classList.remove('hidden');

  const tooltipRect = tooltip.getBoundingClientRect();
  let top = rect.top - tooltipRect.height - 8;
  let left = rect.left - (tooltipRect.width / 2) + (rect.width / 2);

  if (top < 8) top = rect.bottom + 8;
  if (left < 8) left = 8;
  if (left + tooltipRect.width > window.innerWidth - 8) left = window.innerWidth - tooltipRect.width - 8;

  tooltip.style.top = top + 'px';
  tooltip.style.left = left + 'px';
}

function hideCommentTooltip() {
  document.getElementById('comment-tooltip').classList.add('hidden');
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

  return getRegularTasks().filter(t => {
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

// --- STATS (with overdue badge) ---
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

  const overdueCount = filtered.filter(t => {
    if (!t.deadline || t.status === 'completado') return false;
    return new Date(t.deadline) < now;
  }).length;
  document.getElementById('stat-overdue').textContent = overdueCount;
}

function updateOverdueBadge() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const overdueCount = getRegularTasks().filter(t => {
    if (!t.deadline || t.status === 'completado') return false;
    return new Date(t.deadline + 'T00:00:00') < now;
  }).length;

  const badge = document.getElementById('nav-overdue-badge');
  if (overdueCount > 0) {
    badge.textContent = overdueCount;
    badge.classList.remove('hidden');
    badge.classList.add('pulse');
  } else {
    badge.classList.add('hidden');
    badge.classList.remove('pulse');
  }
}

document.querySelectorAll('.stat-card').forEach(card => {
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => {
    const label = card.querySelector('.stat-label')?.textContent?.trim();
    document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
    document.querySelector('.chip[data-filter="all"]').classList.add('active');
    currentFilter.priority = 'all';

    const statusSelect = document.getElementById('filter-status');

    if (label === 'Total') {
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
      statusSelect.value = '';
      currentFilter.status = '';
      currentFilter._overdue = true;
    }

    if (label !== 'Vencidas') {
      currentFilter._overdue = false;
    }

    renderTasks();
    updateStats();
  });
});

// --- LEADER OF THE WEEK ---
function renderLeader() {
  const nameEl = document.getElementById('leader-name');
  const leader = settings.weeklyLeader;
  nameEl.textContent = leader || '—';
}

document.getElementById('leader-randomize').addEventListener('click', async () => {
  const members = (settings.teamMembers || []).map(m => m.name);
  if (members.length === 0) {
    toast('Agregá miembros al equipo primero', 'error');
    return;
  }

  const nameEl = document.getElementById('leader-name');
  let count = 0;
  const interval = setInterval(() => {
    nameEl.textContent = members[Math.floor(Math.random() * members.length)];
    count++;
    if (count >= 15) {
      clearInterval(interval);
      const winner = members[Math.floor(Math.random() * members.length)];
      nameEl.textContent = winner;
      settings.weeklyLeader = winner;
      api('PUT', '/settings', { weeklyLeader: winner }).catch(() => {});
      toast(`${winner} es el lider de la semana!`);
    }
  }, 100);
});

// --- COPY TASK MODAL ---
document.getElementById('copy-modal-close').addEventListener('click', () => {
  document.getElementById('copy-modal').classList.add('hidden');
});
document.getElementById('copy-modal-cancel').addEventListener('click', () => {
  document.getElementById('copy-modal').classList.add('hidden');
});
document.getElementById('copy-modal').querySelector('.modal-backdrop').addEventListener('click', () => {
  document.getElementById('copy-modal').classList.add('hidden');
});

document.getElementById('copy-modal-save').addEventListener('click', async () => {
  const newAssignee = document.getElementById('copy-assignee').value.trim();
  if (!newAssignee) {
    toast('Seleccioná un asignado', 'error');
    return;
  }

  const originalTask = tasks.find(t => t.id === copyingTaskId);
  if (!originalTask) {
    toast('No se encontró la tarea original', 'error');
    document.getElementById('copy-modal').classList.add('hidden');
    return;
  }

  const body = {
    client: originalTask.client,
    project: originalTask.project,
    assignee: newAssignee,
    supervisor: originalTask.supervisor,
    priority: originalTask.priority,
    deadline: originalTask.deadline,
    status: originalTask.status || 'sin empezar',
    owner: originalTask.owner,
    comments: originalTask.comments,
    isSupervision: originalTask.isSupervision || false
  };

  try {
    await api('POST', '/tasks', body);
    toast(`Tarea copiada a ${newAssignee}`);
    document.getElementById('copy-modal').classList.add('hidden');
    copyingTaskId = null;
    await loadData();
  } catch (err) {
    toast('Error al copiar: ' + err.message, 'error');
  }
});

// --- TIME OFF MODAL ---
function openTimeOffModal(entry = null) {
  editingTimeOffId = entry ? entry.id : null;
  const titleEl = document.getElementById('timeoff-modal-title');
  titleEl.textContent = entry ? 'Editar Time Off' : 'Time Off';
  document.getElementById('timeoff-delete').classList.toggle('hidden', !entry);

  document.getElementById('timeoff-member').value = entry?.assignee || '';
  document.getElementById('timeoff-start').value = entry?.timeOffStart || '';
  document.getElementById('timeoff-end').value = entry?.timeOffEnd || '';
  document.getElementById('timeoff-type').value = entry?.timeOffType || 'Vacaciones';

  document.getElementById('timeoff-modal').classList.remove('hidden');
}

function closeTimeOffModal() {
  document.getElementById('timeoff-modal').classList.add('hidden');
  editingTimeOffId = null;
}

document.getElementById('timeoff-modal-close').addEventListener('click', closeTimeOffModal);
document.getElementById('timeoff-cancel').addEventListener('click', closeTimeOffModal);
document.getElementById('timeoff-modal').querySelector('.modal-backdrop').addEventListener('click', closeTimeOffModal);

document.getElementById('timeoff-save').addEventListener('click', async () => {
  const member = document.getElementById('timeoff-member').value.trim();
  const start = document.getElementById('timeoff-start').value;
  const end = document.getElementById('timeoff-end').value;
  const type = document.getElementById('timeoff-type').value;

  if (!member || !start || !end) {
    toast('Completá todos los campos', 'error');
    return;
  }

  const body = {
    client: 'TIME OFF',
    project: type,
    assignee: member,
    priority: '',
    deadline: end,
    status: 'on going',
    supervisor: '',
    owner: '',
    comments: `${type}: ${start} - ${end}`,
    isTimeOff: true,
    timeOffStart: start,
    timeOffEnd: end,
    timeOffType: type
  };

  try {
    if (editingTimeOffId) {
      await api('PUT', `/tasks/${editingTimeOffId}`, body);
      toast('Time off actualizado');
    } else {
      await api('POST', '/tasks', body);
      toast('Time off registrado');
    }
    closeTimeOffModal();
    await loadData();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

document.getElementById('timeoff-delete').addEventListener('click', async () => {
  if (!editingTimeOffId) return;
  if (!confirm('¿Eliminar este time off?')) return;
  try {
    await api('DELETE', `/tasks/${editingTimeOffId}`);
    toast('Time off eliminado');
    closeTimeOffModal();
    await loadData();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// --- CALENDAR VIEW ---
document.getElementById('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});

document.getElementById('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

document.getElementById('cal-today').addEventListener('click', () => {
  const now = new Date();
  calMonth = now.getMonth();
  calYear = now.getFullYear();
  renderCalendar();
});

document.getElementById('cal-filter-deadlines').addEventListener('click', (e) => {
  calFilters.deadlines = !calFilters.deadlines;
  e.currentTarget.classList.toggle('active', calFilters.deadlines);
  renderCalendar();
});

document.getElementById('cal-filter-timeoff').addEventListener('click', (e) => {
  calFilters.timeoff = !calFilters.timeoff;
  e.currentTarget.classList.toggle('active', calFilters.timeoff);
  renderCalendar();
});

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const titleEl = document.getElementById('cal-month-title');

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  titleEl.textContent = `${monthNames[calMonth]} ${calYear}`;

  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  const firstDay = new Date(calYear, calMonth, 1);
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevMonthDays = new Date(calYear, calMonth, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadlineMap = {};
  const timeoffMap = {};

  if (calFilters.deadlines) {
    getRegularTasks().forEach(t => {
      if (!t.deadline) return;
      if (!deadlineMap[t.deadline]) deadlineMap[t.deadline] = [];
      deadlineMap[t.deadline].push(t);
    });
  }

  if (calFilters.timeoff) {
    getTimeOffEntries().forEach(to => {
      if (!to.timeOffStart || !to.timeOffEnd) return;
      const start = new Date(to.timeOffStart + 'T00:00:00');
      const end = new Date(to.timeOffEnd + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        if (!timeoffMap[ds]) timeoffMap[ds] = [];
        const isStart = ds === to.timeOffStart;
        const isEnd = ds === to.timeOffEnd;
        const isSingle = to.timeOffStart === to.timeOffEnd;
        timeoffMap[ds].push({ ...to, _pos: isSingle ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'middle' });
      }
    });
  }

  let html = '';

  dayNames.forEach(d => {
    html += `<div class="calendar-day-header">${d}</div>`;
  });

  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    let dayNum, dateStr, isOtherMonth = false;

    if (i < startDow) {
      dayNum = prevMonthDays - startDow + i + 1;
      const pm = calMonth === 0 ? 11 : calMonth - 1;
      const py = calMonth === 0 ? calYear - 1 : calYear;
      dateStr = `${py}-${String(pm + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      isOtherMonth = true;
    } else if (i - startDow >= daysInMonth) {
      dayNum = i - startDow - daysInMonth + 1;
      const nm = calMonth === 11 ? 0 : calMonth + 1;
      const ny = calMonth === 11 ? calYear + 1 : calYear;
      dateStr = `${ny}-${String(nm + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      isOtherMonth = true;
    } else {
      dayNum = i - startDow + 1;
      dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    }

    const isToday = dateStr === today.toISOString().slice(0, 10);
    const classes = ['calendar-day'];
    if (isToday) classes.push('today');
    if (isOtherMonth) classes.push('other-month');

    const deadlines = deadlineMap[dateStr] || [];
    const timeoffs = timeoffMap[dateStr] || [];

    let eventsHtml = '<div class="calendar-events">';
    let eventCount = 0;
    const maxEvents = 3;

    timeoffs.forEach(to => {
      if (eventCount >= maxEvents) return;
      eventCount++;
      const memberObj = (settings.teamMembers || []).find(m => m.name === to.assignee);
      const color = memberObj?.color || getColorForName(to.assignee);
      const label = to.timeOffType === 'OOO' ? 'OOO' : to.timeOffType === 'Day Off' ? 'Day Off' : 'Vac';
      const pos = to._pos || 'single';
      const showLabel = pos === 'start' || pos === 'single';
      eventsHtml += `<div class="calendar-event timeoff timeoff-${pos}" style="background:${color}" title="${escAttr(to.assignee)} - ${escAttr(to.timeOffType)}">
        ${showLabel ? `<span class="material-icons-round">beach_access</span>${escHtml(to.assignee)} (${label})` : '&nbsp;'}
      </div>`;
    });

    deadlines.forEach(t => {
      if (eventCount >= maxEvents) return;
      eventCount++;
      const isOverdue = new Date(dateStr + 'T00:00:00') < today && t.status !== 'completado';
      const cls = isOverdue ? 'deadline-overdue' : 'deadline';
      eventsHtml += `<div class="calendar-event ${cls}" title="${escAttr(t.project)} - ${escAttr(t.assignee)}">
        <span class="material-icons-round">flag</span>${escHtml(t.project || t.client)}
      </div>`;
    });

    const remaining = (deadlines.length + timeoffs.length) - eventCount;
    if (remaining > 0) {
      eventsHtml += `<div class="calendar-more">+${remaining} más</div>`;
    }

    eventsHtml += '</div>';

    html += `<div class="${classes.join(' ')}">
      <div class="calendar-day-number">${dayNum}</div>
      ${eventsHtml}
    </div>`;
  }

  grid.innerHTML = html;
}

// --- TEAM VIEW ---
function renderTeam() {
  const grid = document.getElementById('team-grid');
  const clientsList = document.getElementById('clients-list');
  const timeOffs = getTimeOffEntries();

  grid.innerHTML = '';
  (settings.teamMembers || []).forEach(member => {
    const taskCount = getRegularTasks().filter(t => t.assignee === member.name).length;
    const memberTimeOffs = timeOffs.filter(to => to.assignee === member.name);

    let timeoffInfo = '';
    if (memberTimeOffs.length > 0) {
      const nextTo = memberTimeOffs[0];
      const type = nextTo.timeOffType || 'Time Off';
      timeoffInfo = `<div class="member-timeoff-info">
        <span class="material-icons-round">beach_access</span>
        ${escHtml(type)}: ${formatDate(nextTo.timeOffStart)} - ${formatDate(nextTo.timeOffEnd)}
      </div>`;
    }

    const initials = member.initials || getInitials(member.name);

    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-avatar" style="background:${member.color || getColorForName(member.name)}">${initials}</div>
      <div class="member-info">
        <h3>${escHtml(member.name)}</h3>
        <p>${escHtml(member.role || 'Equipo')}</p>
        ${timeoffInfo}
      </div>
      <span class="member-tasks-count">${taskCount} tarea${taskCount !== 1 ? 's' : ''}</span>
      <button class="member-edit" data-name="${escAttr(member.name)}" title="Editar">
        <span class="material-icons-round">edit</span>
      </button>
      <button class="member-delete" data-name="${escAttr(member.name)}" title="Eliminar">
        <span class="material-icons-round">close</span>
      </button>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.member-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      const member = (settings.teamMembers || []).find(m => m.name === name);
      if (!member) return;
      openEditMemberModal(member);
    });
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

function openEditMemberModal(member) {
  document.getElementById('prompt-modal-title').textContent = 'Editar miembro';
  document.getElementById('prompt-modal-label').textContent = 'Nombre';
  document.getElementById('prompt-modal-input').value = member.name;

  document.getElementById('prompt-modal-color-group').classList.remove('hidden');
  document.getElementById('prompt-modal-role-group').classList.remove('hidden');
  document.getElementById('prompt-modal-initials-group').classList.remove('hidden');

  document.getElementById('prompt-modal-role').value = member.role || '';

  const initialsInput = document.getElementById('prompt-modal-initials');
  if (initialsInput) initialsInput.value = member.initials || getInitials(member.name);

  const colorsDiv = document.getElementById('prompt-modal-colors');
  colorsDiv.innerHTML = '';
  COLORS.forEach(c => {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch ${c === member.color ? 'selected' : ''}`;
    swatch.style.background = c;
    swatch.dataset.color = c;
    swatch.addEventListener('click', () => {
      colorsDiv.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    colorsDiv.appendChild(swatch);
  });

  promptCallback = async ({ name, color, role }) => {
    const idx = settings.teamMembers.findIndex(m => m.name === member.name);
    if (idx === -1) return;

    const initialsVal = document.getElementById('prompt-modal-initials')?.value?.trim() || '';

    const oldName = member.name;
    settings.teamMembers[idx] = { name, color, role, initials: initialsVal || getInitials(name) };

    try {
      await api('PUT', '/settings', { teamMembers: settings.teamMembers });

      if (oldName !== name) {
        const updatePromises = [];
        tasks.forEach(t => {
          const updates = {};
          if (t.assignee === oldName) updates.assignee = name;
          if (t.supervisor === oldName) updates.supervisor = name;
          if (t.owner === oldName) updates.owner = name;
          if (Object.keys(updates).length > 0) {
            updatePromises.push(api('PUT', `/tasks/${t.id}`, updates));
          }
        });
        await Promise.all(updatePromises);
      }

      await loadData();
      toast(`Miembro actualizado`);
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  };

  document.getElementById('prompt-modal').classList.remove('hidden');
  document.getElementById('prompt-modal-input').focus();
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
  document.getElementById('prompt-modal-initials-group').classList.toggle('hidden', !showRole);

  const initialsInput = document.getElementById('prompt-modal-initials');
  if (initialsInput) initialsInput.value = '';

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
    const initialsVal = document.getElementById('prompt-modal-initials')?.value?.trim() || '';
    settings.teamMembers = [...(settings.teamMembers || []), { name, color, role, initials: initialsVal || getInitials(name) }];
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
  if (diff <= 2) return 'urgent';
  if (diff <= 7) return 'warning';
  return '';
}

// --- CELL SAVE HIGHLIGHT ---
function highlightCell(taskId, field) {
  setTimeout(() => {
    const row = document.querySelector(`tr[data-id="${taskId}"]`);
    if (!row) return;
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (!cell) return;
    cell.classList.add('cell-saved');
    setTimeout(() => cell.classList.remove('cell-saved'), 800);
  }, 50);
}

// --- UNDO SYSTEM ---
function pushUndo(taskId, field, oldValue, newValue) {
  if (oldValue === newValue) return;
  undoStack.push({ taskId, field, oldValue, newValue, timestamp: Date.now() });
  if (undoStack.length > MAX_UNDO) undoStack.shift();

  const fieldNames = {
    client: 'Cliente', project: 'Proyecto', assignee: 'Asignado',
    supervisor: 'Supervisor', priority: 'Prioridad', deadline: 'Deadline',
    status: 'Status', owner: 'Owner', comments: 'Comentario'
  };
  const label = fieldNames[field] || field;
  toast(`${label} actualizado`, 'success', {
    label: 'Deshacer',
    callback: performUndo
  });
}

async function performUndo() {
  if (undoStack.length === 0) {
    toast('Nada para deshacer', 'info');
    return;
  }
  const entry = undoStack.pop();
  try {
    const update = {};
    update[entry.field] = entry.oldValue;
    await api('PUT', `/tasks/${entry.taskId}`, update);
    const task = tasks.find(t => t.id === entry.taskId);
    if (task) task[entry.field] = entry.oldValue;
    renderTasks();
    updateStats();
    updateOverdueBadge();
    toast('Cambio deshecho');
    highlightCell(entry.taskId, entry.field);
  } catch (err) {
    toast('Error al deshacer: ' + err.message, 'error');
    // Put it back
    undoStack.push(entry);
  }
}

// --- SEARCH OVERLAY (Ctrl+K) ---
function openSearchOverlay() {
  const overlay = document.getElementById('search-overlay');
  const input = document.getElementById('search-overlay-input');
  const results = document.getElementById('search-overlay-results');

  overlay.classList.remove('hidden');
  input.value = '';
  results.innerHTML = '';
  searchSelectedIdx = -1;
  setTimeout(() => input.focus(), 50);

  // Close on backdrop click
  overlay.querySelector('.search-overlay-backdrop').onclick = closeSearchOverlay;
}

function closeSearchOverlay() {
  document.getElementById('search-overlay').classList.add('hidden');
  searchSelectedIdx = -1;
}

function performOverlaySearch(query) {
  const results = document.getElementById('search-overlay-results');
  if (!query || query.length < 2) {
    results.innerHTML = '<div class="search-no-results">Escribí al menos 2 caracteres...</div>';
    return;
  }

  const q = query.toLowerCase();
  const matches = getRegularTasks().filter(t => {
    const hay = [t.client, t.project, t.assignee, t.supervisor, t.owner, t.comments, t.status]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }).slice(0, 10);

  if (matches.length === 0) {
    results.innerHTML = '<div class="search-no-results">Sin resultados</div>';
    return;
  }

  results.innerHTML = '';
  searchSelectedIdx = -1;

  matches.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.dataset.index = i;
    item.dataset.taskId = t.id;

    const clientColor = getClientColor(t.client);
    item.innerHTML = `
      <span class="material-icons-round result-icon">assignment</span>
      <div class="search-result-info">
        <div class="search-result-title">${escHtml(t.project || 'Sin proyecto')}</div>
        <div class="search-result-meta">
          <span class="client-badge" style="background:${clientColor.bg};color:${clientColor.text};font-size:.65rem;padding:.1rem .35rem">${escHtml(t.client || '—')}</span>
          ${t.assignee ? `&nbsp;·&nbsp;${escHtml(t.assignee)}` : ''}
          ${t.status ? `&nbsp;·&nbsp;${escHtml(t.status)}` : ''}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      navigateToTask(t.id);
      closeSearchOverlay();
    });

    results.appendChild(item);
  });
}

function navigateToTask(taskId) {
  switchView('agenda');
  // Reset filters to show all
  currentFilter = { priority: 'all', assignee: '', status: '', client: '', search: '' };
  document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
  document.querySelector('.chip[data-filter="all"]')?.classList.add('active');
  document.getElementById('filter-assignee').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-client').value = '';
  document.getElementById('search-input').value = '';

  // Expand all groups
  collapsedGroups = {};
  localStorage.setItem('agenda_collapsed', JSON.stringify(collapsedGroups));

  renderTasks();
  updateStats();

  setTimeout(() => {
    const row = document.querySelector(`tr[data-id="${taskId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('cell-saved');
      setTimeout(() => row.classList.remove('cell-saved'), 1200);
    }
  }, 100);
}

// Search overlay input listener
document.getElementById('search-overlay-input').addEventListener('input', (e) => {
  performOverlaySearch(e.target.value.trim());
});

// Search overlay keyboard navigation
document.getElementById('search-overlay-input').addEventListener('keydown', (e) => {
  const results = document.getElementById('search-overlay-results');
  const items = results.querySelectorAll('.search-result-item');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    searchSelectedIdx = Math.min(searchSelectedIdx + 1, items.length - 1);
    items.forEach((item, i) => item.classList.toggle('active', i === searchSelectedIdx));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    searchSelectedIdx = Math.max(searchSelectedIdx - 1, 0);
    items.forEach((item, i) => item.classList.toggle('active', i === searchSelectedIdx));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (searchSelectedIdx >= 0 && items[searchSelectedIdx]) {
      const taskId = items[searchSelectedIdx].dataset.taskId;
      navigateToTask(taskId);
      closeSearchOverlay();
    }
  } else if (e.key === 'Escape') {
    closeSearchOverlay();
  }
});

// --- CSV EXPORT ---
function exportCSV() {
  const regularTasks = getRegularTasks();
  if (regularTasks.length === 0) {
    toast('No hay tareas para exportar', 'info');
    return;
  }

  const headers = ['#', 'Cliente', 'Proyecto', 'Asignado', 'Supervisor', 'Prioridad', 'Deadline', 'Status', 'Owner', 'Comentarios'];
  const rows = regularTasks.map(t => [
    t.taskNumber || '',
    t.client || '',
    t.project || '',
    t.assignee || '',
    t.supervisor || '',
    t.priority || '',
    t.deadline || '',
    t.status || '',
    t.owner || '',
    (t.comments || '').replace(/"/g, '""')
  ]);

  let csv = headers.map(h => `"${h}"`).join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${cell}"`).join(',') + '\n';
  });

  // BOM for Excel UTF-8 compatibility
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agenda-lc-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado');
}

document.getElementById('export-csv-btn').addEventListener('click', exportCSV);

// --- COMPLETION CELEBRATION ---
function checkCelebration(task) {
  if (!task.assignee) return;
  const personTasks = getRegularTasks().filter(t => t.assignee === task.assignee);
  const allDone = personTasks.every(t => t.status === 'completado');

  // Always celebrate individual completion
  const row = document.querySelector(`tr[data-id="${task.id}"]`);
  if (row) {
    row.classList.add('row-completed');
    setTimeout(() => row.classList.remove('row-completed'), 1200);
  }

  // All tasks done for person → big celebration
  if (allDone && personTasks.length > 0) {
    toast(`${task.assignee} completó todas sus tareas!`);
    launchConfetti();
  }
}

function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#8b5cf6'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    const angle = (Math.PI * 2 * i) / 40;
    const distance = 80 + Math.random() * 200;
    piece.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--y', `${Math.sin(angle) * distance - 100}px`);
    piece.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 2000);
}

// --- PRESENCE SYSTEM ---
function reportPresence(taskId, field) {
  fetch('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ sessionId, taskId, field })
  }).catch(() => {});
}

function clearPresence() {
  fetch('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ sessionId })
  }).catch(() => {});
}

async function pollPresence() {
  try {
    const res = await fetch(`/api/presence?exclude=${sessionId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    renderPresenceIndicators(data);
  } catch {}
}

function renderPresenceIndicators(data) {
  // Remove old presence indicators
  document.querySelectorAll('.cell-presence').forEach(el => {
    el.classList.remove('cell-presence');
    el.style.removeProperty('--presence-color');
    const dot = el.querySelector('.presence-dot');
    if (dot) dot.remove();
  });

  const presenceColors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'];

  data.forEach((p, i) => {
    const row = document.querySelector(`tr[data-id="${p.taskId}"]`);
    if (!row) return;
    const cell = row.querySelector(`[data-field="${p.field}"]`);
    if (!cell) return;

    const color = presenceColors[i % presenceColors.length];
    cell.classList.add('cell-presence');
    cell.style.setProperty('--presence-color', color);

    const dot = document.createElement('div');
    dot.className = 'presence-dot';
    dot.style.background = color;
    cell.style.position = 'relative';
    cell.appendChild(dot);
  });
}

function startPresencePolling() {
  if (presenceInterval) return;
  presenceInterval = setInterval(pollPresence, 3000);
  pollPresence();
}

function stopPresencePolling() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
  clearPresence();
}

// --- KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', (e) => {
  // Ctrl+K or Cmd+K → search overlay
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const overlay = document.getElementById('search-overlay');
    if (overlay.classList.contains('hidden')) {
      openSearchOverlay();
    } else {
      closeSearchOverlay();
    }
    return;
  }

  // Ctrl+Z or Cmd+Z → undo (only when not in an input)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input, textarea, select, [contenteditable]')) {
    e.preventDefault();
    performUndo();
    return;
  }

  if (e.key === 'Escape') {
    // Close search overlay first if open
    if (!document.getElementById('search-overlay').classList.contains('hidden')) {
      closeSearchOverlay();
      return;
    }
    closeEditDropdown();
    closeInlineInput();
    closePromptModal();
    closeTimeOffModal();
    document.getElementById('copy-modal').classList.add('hidden');
  }
});

// --- INIT ---
if (token) {
  showApp();
  loadData();
} else {
  showLogin();
}
