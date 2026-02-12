/* ===========================
   AGENDA LC - App Logic
   =========================== */

// --- STATE ---
let token = localStorage.getItem('agenda_token') || null;
let tasks = [];
let settings = { teamMembers: [], clients: [], supervisors: [], owners: [], assigneeOrder: [] };
let currentFilter = { priority: 'all', assignee: '', status: '', client: '', search: '' };
let grouped = true;
let editingTaskId = null;
let editingTimeOffId = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calFilters = { deadlines: true, timeoff: true };
let draggedGroup = null;

// Preset colors for avatars
const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#f97316', '#14b8a6',
  '#a855f7', '#e11d48', '#0ea5e9', '#84cc16', '#d946ef'
];

const PRIORITY_CYCLE = ['alta', 'media', 'baja', 'TBD'];

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

document.addEventListener('click', () => {
  addTaskMenu.classList.add('hidden');
});

document.getElementById('add-task-regular').addEventListener('click', () => {
  addTaskMenu.classList.add('hidden');
  openTaskModal();
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

  const allClients = [...new Set([
    ...(settings.clients || []).map(c => c.name),
    ...tasks.map(t => t.client).filter(Boolean)
  ])].sort();

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
function getRegularTasks() {
  return tasks.filter(t => !t.isTimeOff);
}

function getTimeOffEntries() {
  return tasks.filter(t => t.isTimeOff);
}

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

  // Sort groups by saved order
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
    const groupTasks = groups[assignee];
    const member = (settings.teamMembers || []).find(m => m.name === assignee);
    const color = member?.color || getColorForName(assignee);
    const initials = getInitials(assignee);

    // Get time off entries for this member
    const memberTimeOffs = timeOffs.filter(to => to.assignee === assignee);

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
        const type = to.timeOffType || 'Tiempo libre';
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
    });

    // Time off badge click -> open time off modal for editing
    header.querySelectorAll('.timeoff-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const toTask = tasks.find(t => t.id === badge.dataset.id);
        if (toTask) openTimeOffModal(toTask);
      });
    });

    // Drag and drop for reordering
    header.addEventListener('dragstart', (e) => {
      draggedGroup = assignee;
      header.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    header.addEventListener('dragend', () => {
      header.classList.remove('dragging');
      container.querySelectorAll('.group-header').forEach(h => h.classList.remove('drag-over'));
      draggedGroup = null;
    });

    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (header.dataset.assignee !== draggedGroup) {
        header.classList.add('drag-over');
      }
    });

    header.addEventListener('dragleave', () => {
      header.classList.remove('drag-over');
    });

    header.addEventListener('drop', (e) => {
      e.preventDefault();
      header.classList.remove('drag-over');
      if (!draggedGroup || draggedGroup === assignee) return;

      // Compute new order
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
    const supervisionTag = t.isSupervision
      ? '<span class="supervision-tag"><span class="material-icons-round">visibility</span>Supervisión</span>'
      : '';

    html += `
      <tr data-id="${t.id}">
        <td><span class="client-badge" style="background:${clientColor.bg};color:${clientColor.text}">${escHtml(t.client || '—')}</span></td>
        <td style="color:var(--text-muted);font-size:.8rem">${t.taskNumber || ''}</td>
        <td class="task-project-cell">${escHtml(t.project || '—')}${supervisionTag}</td>
        <td style="color:var(--text-secondary)">${escHtml(t.supervisor || '—')}</td>
        <td><span class="priority-badge clickable ${priorityClass}" data-task-id="${t.id}" title="Click para cambiar prioridad">${escHtml(t.priority || '—')}</span></td>
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
  // Row click -> open modal
  wrapper.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't open modal if clicking priority badge
      if (e.target.closest('.priority-badge.clickable')) return;
      const task = tasks.find(t => t.id === row.dataset.id);
      if (task) openTaskModal(task);
    });
  });

  // Priority badge click -> cycle priority
  wrapper.querySelectorAll('.priority-badge.clickable').forEach(badge => {
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = badge.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      const currentPriority = (task.priority || '').toLowerCase();
      const currentIdx = PRIORITY_CYCLE.indexOf(currentPriority);
      const nextIdx = (currentIdx + 1) % PRIORITY_CYCLE.length;
      const newPriority = PRIORITY_CYCLE[nextIdx];

      try {
        await api('PUT', `/tasks/${taskId}`, { priority: newPriority });
        task.priority = newPriority;
        renderTasks();
        updateStats();
        toast(`Prioridad: ${newPriority}`);
      } catch (err) {
        toast('Error al cambiar prioridad', 'error');
      }
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

// --- TASK MODAL ---
const modal = document.getElementById('task-modal');
const modalClose = document.getElementById('modal-close');
const modalCancel = document.getElementById('modal-cancel');
const modalDelete = document.getElementById('modal-delete');
const modalCopy = document.getElementById('modal-copy');
const taskForm = document.getElementById('task-form');

function openTaskModal(task = null) {
  editingTaskId = task ? task.id : null;
  document.getElementById('modal-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  modalDelete.classList.toggle('hidden', !task);
  modalCopy.classList.toggle('hidden', !task);

  document.getElementById('task-client').value = task?.client || '';
  document.getElementById('task-project').value = task?.project || '';
  document.getElementById('task-assignee').value = task?.assignee || '';
  document.getElementById('task-supervisor').value = task?.supervisor || '';
  document.getElementById('task-priority').value = task?.priority || '';
  document.getElementById('task-deadline').value = task?.deadline || '';
  document.getElementById('task-status').value = task?.status || 'sin empezar';
  document.getElementById('task-owner').value = task?.owner || '';
  document.getElementById('task-comments').value = task?.comments || '';
  document.getElementById('task-supervision').checked = task?.isSupervision || false;

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
    comments: document.getElementById('task-comments').value.trim(),
    isSupervision: document.getElementById('task-supervision').checked
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

// --- COPY TASK ---
modalCopy.addEventListener('click', () => {
  if (!editingTaskId) return;
  closeTaskModal();
  document.getElementById('copy-assignee').value = '';
  document.getElementById('copy-modal').classList.remove('hidden');
});

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

  const originalTask = tasks.find(t => t.id === editingTaskId);
  if (!originalTask) return;

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
    editingTaskId = null;
    await loadData();
  } catch (err) {
    toast('Error al copiar: ' + err.message, 'error');
  }
});

// --- TIME OFF MODAL ---
function openTimeOffModal(entry = null) {
  editingTimeOffId = entry ? entry.id : null;
  const titleEl = document.getElementById('timeoff-modal-title');
  titleEl.textContent = entry ? 'Editar tiempo libre' : 'Tiempo libre';
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
      toast('Tiempo libre actualizado');
    } else {
      await api('POST', '/tasks', body);
      toast('Tiempo libre registrado');
    }
    closeTimeOffModal();
    await loadData();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

document.getElementById('timeoff-delete').addEventListener('click', async () => {
  if (!editingTimeOffId) return;
  if (!confirm('¿Eliminar este tiempo libre?')) return;
  try {
    await api('DELETE', `/tasks/${editingTimeOffId}`);
    toast('Tiempo libre eliminado');
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

  // First day of month
  const firstDay = new Date(calYear, calMonth, 1);
  let startDow = firstDay.getDay() - 1; // Monday = 0
  if (startDow < 0) startDow = 6;

  // Days in month
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // Previous month days
  const prevMonthDays = new Date(calYear, calMonth, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build events map
  const deadlineMap = {}; // dateStr -> [task, ...]
  const timeoffMap = {};  // dateStr -> [entry, ...]

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
        timeoffMap[ds].push(to);
      }
    });
  }

  let html = '';

  // Day headers
  dayNames.forEach(d => {
    html += `<div class="calendar-day-header">${d}</div>`;
  });

  // Calendar days
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    let dayNum, dateStr, isOtherMonth = false;

    if (i < startDow) {
      // Previous month
      dayNum = prevMonthDays - startDow + i + 1;
      const pm = calMonth === 0 ? 11 : calMonth - 1;
      const py = calMonth === 0 ? calYear - 1 : calYear;
      dateStr = `${py}-${String(pm + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      isOtherMonth = true;
    } else if (i - startDow >= daysInMonth) {
      // Next month
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

    // Time off events
    timeoffs.forEach(to => {
      if (eventCount >= maxEvents) return;
      eventCount++;
      const memberObj = (settings.teamMembers || []).find(m => m.name === to.assignee);
      const color = memberObj?.color || getColorForName(to.assignee);
      const label = to.timeOffType === 'OOO' ? 'OOO' : to.timeOffType === 'Day Off' ? 'Day Off' : 'Vac';
      eventsHtml += `<div class="calendar-event timeoff" style="background:${color}" title="${escAttr(to.assignee)} - ${escAttr(to.timeOffType)}">
        <span class="material-icons-round">beach_access</span>${escHtml(to.assignee)} (${label})
      </div>`;
    });

    // Deadline events
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
      const type = nextTo.timeOffType || 'Tiempo libre';
      timeoffInfo = `<div class="member-timeoff-info">
        <span class="material-icons-round">beach_access</span>
        ${escHtml(type)}: ${formatDate(nextTo.timeOffStart)} - ${formatDate(nextTo.timeOffEnd)}
      </div>`;
    }

    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-avatar" style="background:${member.color || getColorForName(member.name)}">${getInitials(member.name)}</div>
      <div class="member-info">
        <h3>${escHtml(member.name)}</h3>
        <p>${escHtml(member.role || 'Equipo')}</p>
        ${timeoffInfo}
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
  if (diff <= 2) return 'urgent';
  if (diff <= 7) return 'warning';
  return '';
}

// --- KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTaskModal();
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
