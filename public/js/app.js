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
let calFilters = { deadlines: true, timeoff: true, assignees: new Set() };
let undoStack = [];
let redoGuard = false;
let draggedGroup = null;
let activeEditDropdown = null;
let activeInlineInput = null;
let copyingTaskId = null;

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

  if (view === 'calendar') {
    renderCalendarAssigneeFilters();
    renderCalendar();
  }
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
  const project = prompt('Tema / Proyecto');
  if (project === null) return;
  const assignee = prompt('Asignado (rol Equipo)') || '';
  const client = prompt('Cliente') || '';
  try {
    const body = {
      client,
      project,
      assignee,
      supervisor: '',
      priority: 'TBD',
      taskNumber: '',
      deadline: '',
      status: 'sin empezar',
      owner: '',
      comments: '',
      isSupervision: false
    };
    await api('POST', '/tasks', body);
    await loadData();
    toast('Nueva tarea creada');
  } catch (err) {
    toast('Error al crear tarea: ' + err.message, 'error');
  }
});

document.getElementById('add-timeoff-btn').addEventListener('click', () => {
  addTaskMenu.classList.add('hidden');
  openTimeOffModal();
});

// --- DATA LOADING ---
async function loadData() {
  try {
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
  assignees.forEach(a => calFilters.assignees.add(a));
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
  renderCalendarAssigneeFilters();
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
    case 'assignee': {
      const teams = (settings.teamMembers || []).filter(m => (m.role || 'Equipo') === 'Equipo').map(m => m.name);
      return teams.sort();
    }
    case 'supervisor': return allPeople;
    case 'owner':
      return (settings.teamMembers || []).filter(m => (m.role || '') === 'Owner').map(m => m.name).sort();
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
  }

  // Render esperando respuesta section at the bottom
  if (esperandoTasks.length > 0) {
    renderEsperandoSection(container, esperandoTasks);
  }
}

function renderEsperandoSection(container, esperandoTasks) {
  const section = document.createElement('div');
  section.className = 'esperando-section';

  const header = document.createElement('div');
  header.className = 'esperando-header';
  header.innerHTML = `
    <span class="material-icons-round">hourglass_top</span>
    <span class="group-name">Esperando Respuesta</span>
    <span class="group-count">${esperandoTasks.length} tarea${esperandoTasks.length !== 1 ? 's' : ''}</span>
    <span class="material-icons-round group-toggle">expand_more</span>
  `;

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-wrapper';
  const sorted = sortTasksByNumber(esperandoTasks);
  tableWrapper.innerHTML = buildTaskTable(sorted, true);

  header.addEventListener('click', () => {
    header.querySelector('.group-toggle').classList.toggle('collapsed');
    tableWrapper.classList.toggle('hidden');
  });

  section.appendChild(header);
  section.appendChild(tableWrapper);
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
  const completedByAssignee = {};
  filtered.forEach(t => {
    if (t.status === 'completado') {
      const ck = t.assignee || 'Sin asignar';
      if (!completedByAssignee[ck]) completedByAssignee[ck] = [];
      completedByAssignee[ck].push(t);
      return;
    }
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

  sortedKeys.forEach((assignee) => {
    const groupTasks = sortTasksByNumber(groups[assignee]);
    const member = (settings.teamMembers || []).find(m => m.name === assignee);
    const color = member?.color || getColorForName(assignee);
    const initials = member?.initials || getInitials(assignee);

    const memberTimeOffs = timeOffs.filter(to => to.assignee === assignee);
    const completedTasks = sortTasksByNumber(completedByAssignee[assignee] || []);

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

    header.innerHTML = `
      <span class="material-icons-round drag-handle">drag_indicator</span>
      <div class="group-avatar" style="background:${color}">${initials}</div>
      <span class="group-name">${escHtml(assignee)}</span>
      <span class="group-count">${groupTasks.length} tarea${groupTasks.length !== 1 ? 's' : ''}</span>
      ${timeoffHtml}
      <span class="material-icons-round group-toggle">expand_more</span>
    `;

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    tableWrapper.innerHTML = buildTaskTable(groupTasks);

    // Toggle collapse
    header.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle') || e.target.closest('.timeoff-badge')) return;
      const toggle = header.querySelector('.group-toggle');
      toggle.classList.toggle('collapsed');
      tableWrapper.classList.toggle('hidden');
      const collapsed = new Set(JSON.parse(localStorage.getItem('collapsedGroups') || '[]'));
      if (tableWrapper.classList.contains('hidden')) collapsed.add(assignee);
      else collapsed.delete(assignee);
      localStorage.setItem('collapsedGroups', JSON.stringify([...collapsed]));
    });

    const collapsed = new Set(JSON.parse(localStorage.getItem('collapsedGroups') || '[]'));
    if (collapsed.has(assignee)) {
      header.querySelector('.group-toggle').classList.add('collapsed');
      tableWrapper.classList.add('hidden');
    }

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
      if (e.target.closest('tr[data-id]')) return; // Don't interfere with task row drags
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
      // Could be a group reorder or a task drop from esperando
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
        // Task dropped from esperando section onto a group header
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

      // Group reorder
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
    bindTaskRows(tableWrapper);

    if (completedTasks.length > 0) {
      const completedWrap = document.createElement('div');
      completedWrap.className = 'table-wrapper completed-wrapper';
      completedWrap.innerHTML = `<div class="completed-title">Completadas</div>${buildTaskTable(completedTasks)}`;
      container.appendChild(completedWrap);
      bindTaskRows(completedWrap);
    }
  });
}

function buildTaskTable(taskList, showAssignee = false) {
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
        <td class="editable-cell" data-field="taskNumber" style="color:var(--text-muted);font-size:.8rem">${t.taskNumber || ''}</td>
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

  html += '</tbody></table>';
  return html;
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
}

// --- INLINE EDITING ---
function startInlineEdit(cell, task, field) {
  if (activeEditDropdown && activeEditDropdown.task.id === task.id && activeEditDropdown.field === field) {
    closeEditDropdown();
    return;
  }
  closeEditDropdown();
  closeInlineInput();

  const dropdownFields = ['client', 'assignee', 'supervisor', 'owner', 'status', 'priority'];
  const textFields = ['project', 'comments', 'taskNumber'];

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
  let supervisionCheckbox = null;
  if (field === 'project') {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '.5rem';
    supervisionCheckbox = document.createElement('input');
    supervisionCheckbox.type = 'checkbox';
    supervisionCheckbox.checked = !!task.isSupervision;
    wrap.appendChild(input);
    wrap.appendChild(supervisionCheckbox);
    cell.appendChild(wrap);
  } else {
    cell.appendChild(input);
  }
  input.focus();
  input.select();

  activeInlineInput = { cell, originalHtml, input };

  const save = async () => {
    const newValue = input.value.trim();
    if (newValue !== currentValue) {
      try {
        const update = {};
        update[field] = newValue;
        if (field === 'project' && supervisionCheckbox) update.isSupervision = supervisionCheckbox.checked;
        await updateTask(task.id, update, `Deshecho: ${field} → ${currentValue || 'vacío'}`);
        task[field] = newValue;
        if (field === 'project' && supervisionCheckbox) task.isSupervision = supervisionCheckbox.checked;
        toast('Actualizado');
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }
    closeInlineInput();
    renderTasks();
    updateStats();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { closeInlineInput(); cell.innerHTML = originalHtml; }
  });
  input.addEventListener('blur', () => {
    // Small delay to allow click events to fire first
    setTimeout(() => {
      if (activeInlineInput && activeInlineInput.input === input) save();
    }, 150);
  });
}

async function updateTask(taskId, patch, undoLabel = 'Deshecho') {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;
  const before = {};
  Object.keys(patch).forEach(k => { before[k] = task[k]; });
  const updated = await api('PUT', `/tasks/${taskId}`, patch);
  if (!redoGuard) undoStack.push({ taskId, before, label: undoLabel });
  return updated;
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
        await updateTask(task.id, { deadline: newValue }, `Deshecho: deadline → ${currentValue || 'vacío'}`);
        task.deadline = newValue;
        toast('Deadline actualizado');
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }
    closeInlineInput();
    renderTasks();
    updateStats();
  };

  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeInlineInput(); cell.innerHTML = originalHtml; }
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
        selectDropdownOption(task, field, opt);
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
    selectDropdownOption(task, field, newName);
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
        settings.teamMembers = [...(settings.teamMembers || []), { name: newName, color, role: 'Equipo' }];
        api('PUT', '/settings', { teamMembers: settings.teamMembers }).catch(() => {});
      }
    }
  };

  dropdown.classList.remove('hidden');
  searchInput.focus();

  activeEditDropdown = { dropdown, cell, task, field };
}

async function selectDropdownOption(task, field, value) {
  closeEditDropdown();
  try {
    const update = {};
    update[field] = value;
    await updateTask(task.id, update, `Deshecho: ${field} → ${task[field] || 'vacío'}`);
    task[field] = value;
    toast('Actualizado');
    renderTasks();
    updateStats();
    populateFilterDropdowns();
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

  // Position above the cell
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

  // Animate the randomizer
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
  document.getElementById('timeoff-title').value = entry?.timeOffTitle || '';

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
  const title = document.getElementById('timeoff-title').value.trim();

  if (!member || !start || !end) {
    toast('Completá todos los campos', 'error');
    return;
  }

  const body = {
    client: 'TIME OFF',
    project: title || type,
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
    timeOffType: type,
    timeOffTitle: title
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
      if (t.assignee && calFilters.assignees.size && !calFilters.assignees.has(t.assignee)) return;
      if (!t.deadline) return;
      if (!deadlineMap[t.deadline]) deadlineMap[t.deadline] = [];
      deadlineMap[t.deadline].push(t);
    });
  }

  if (calFilters.timeoff) {
    getTimeOffEntries().forEach(to => {
      if (to.assignee && calFilters.assignees.size && !calFilters.assignees.has(to.assignee)) return;
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
      const label = to.timeOffTitle || (to.timeOffType === 'OOO' ? 'OOO' : to.timeOffType === 'Day Off' ? 'Day Off' : 'Vac');
      const pos = to._pos || 'single';
      const showLabel = pos === 'start' || pos === 'single';
      eventsHtml += `<div class="calendar-event timeoff timeoff-${pos}" data-task-id="${to.id}" data-event-type="timeoff" style="background:${color}" title="${escAttr(to.assignee)} - ${escAttr(to.timeOffType)}">
        ${showLabel ? `<span class="material-icons-round">beach_access</span>${escHtml(label)}` : '&nbsp;'}
      </div>`;
    });

    deadlines.forEach(t => {
      if (eventCount >= maxEvents) return;
      eventCount++;
      const isOverdue = new Date(dateStr + 'T00:00:00') < today && t.status !== 'completado';
      const cls = isOverdue ? 'deadline-overdue' : 'deadline';
      eventsHtml += `<div class="calendar-event ${cls}" data-task-id="${t.id}" data-event-type="deadline" title="${escAttr(t.project)} - ${escAttr(t.assignee)}">
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

  grid.querySelectorAll('.calendar-event[data-task-id]').forEach(ev => {
    ev.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = ev.dataset.taskId;
      const type = ev.dataset.eventType;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      if (type === 'timeoff') {
        const action = prompt('Editar Time Off: fecha inicio (YYYY-MM-DD), fecha fin (YYYY-MM-DD) o "delete"');
        if (!action) return;
        if (action.toLowerCase() === 'delete') {
          await api('DELETE', `/tasks/${taskId}`);
          toast('Time off eliminado');
          return loadData();
        }
        const [start, end] = action.split(',').map(v => (v || '').trim());
        if (start && end) {
          await updateTask(taskId, { timeOffStart: start, timeOffEnd: end, deadline: end }, 'Deshecho: editar time off');
          await loadData();
        }
      } else {
        const action = prompt('Editar deadline (YYYY-MM-DD) o "delete" para eliminar tarea', task.deadline || '');
        if (!action) return;
        if (action.toLowerCase() === 'delete') {
          await api('DELETE', `/tasks/${taskId}`);
          toast('Tarea eliminada');
          return loadData();
        }
        await updateTask(taskId, { deadline: action.trim() }, 'Deshecho: editar deadline');
        await loadData();
      }
    });
  });
}

function renderCalendarAssigneeFilters() {
  const wrap = document.getElementById('cal-assignee-filters');
  if (!wrap) return;
  const assignees = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean)
  ])].sort();
  if (!assignees.length) {
    wrap.innerHTML = '';
    return;
  }
  assignees.forEach(a => calFilters.assignees.add(a));
  wrap.innerHTML = assignees
    .map(a => `<button class="chip ${calFilters.assignees.has(a) ? 'active' : ''}" data-assignee="${escAttr(a)}">${escHtml(a)}</button>`)
    .join('');

  wrap.querySelectorAll('button[data-assignee]').forEach(btn => {
    btn.addEventListener('click', () => {
      const assignee = btn.dataset.assignee;
      if (calFilters.assignees.has(assignee)) {
        calFilters.assignees.delete(assignee);
      } else {
        calFilters.assignees.add(assignee);
      }
      btn.classList.toggle('active', calFilters.assignees.has(assignee));
      renderCalendar();
    });
  });
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
      const type = nextTo.timeOffType || 'Tiempo libre';
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

  // Edit member
  grid.querySelectorAll('.member-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      const member = (settings.teamMembers || []).find(m => m.name === name);
      if (!member) return;
      openEditMemberModal(member);
    });
  });

  // Delete member
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

    // Update member in settings
    const oldName = member.name;
    settings.teamMembers[idx] = { name, color, role, initials: initialsVal || getInitials(name) };

    try {
      await api('PUT', '/settings', { teamMembers: settings.teamMembers });

      // If name changed, update all tasks referencing this member
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
  document.getElementById('prompt-modal-role').value = 'Equipo';
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

document.getElementById('settings-manage-team')?.addEventListener('click', () => switchView('team'));
document.getElementById('settings-manage-clients')?.addEventListener('click', () => switchView('team'));
document.getElementById('settings-export-csv')?.addEventListener('click', () => exportTasksCsv());

function exportTasksCsv() {
  const headers = ['id', 'cliente', 'numero', 'proyecto', 'asignado', 'supervisor', 'prioridad', 'deadline', 'status', 'owner', 'comentarios'];
  const rows = getRegularTasks().map(t => [
    t.id, t.client, t.taskNumber || '', t.project, t.assignee, t.supervisor,
    t.priority, t.deadline, t.status, t.owner, t.comments
  ].map(v => `"${String(v || '').replaceAll('"', '""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agenda-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
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

// --- KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    const action = undoStack.pop();
    if (action) {
      redoGuard = true;
      updateTask(action.taskId, action.before).finally(async () => {
        redoGuard = false;
        await loadData();
        toast(action.label || 'Deshecho', 'info');
      });
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const input = document.getElementById('search-input');
    if (input) {
      input.focus();
      input.select();
    }
    return;
  }
  if (e.key === 'Escape') {
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
