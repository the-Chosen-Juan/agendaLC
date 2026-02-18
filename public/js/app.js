/* ===========================
   AGENDA LC - App Logic
   =========================== */

// --- STATE ---
let token = localStorage.getItem('agenda_token') || null;
let tasks = [];
let settings = { teamMembers: [], clients: [], supervisors: [], owners: [], assigneeOrder: [], weeklyLeader: null, leaderPool: [], autoDeleteDays: 2 };
let currentFilter = { priority: 'all', assignee: '', status: '', client: '', search: '' };
let grouped = true;
let editingTaskId = null;
let editingTimeOffId = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calFilters = JSON.parse(localStorage.getItem('agenda_calFilters') || '{"deadlines":true,"timeoff":true}');
let calAssigneeFilters = JSON.parse(localStorage.getItem('agenda_calAssigneeFilters') || '{}');

function saveCalFilters() {
  localStorage.setItem('agenda_calFilters', JSON.stringify(calFilters));
  localStorage.setItem('agenda_calAssigneeFilters', JSON.stringify(calAssigneeFilters));
}
let calEventEditData = null;
let draggedGroup = null;
let activeEditDropdown = null;
let activeInlineInput = null;
let copyingTaskId = null;

// --- FLATPICKR DATE PICKER HELPER ---
function initDatePicker(el, opts = {}) {
  return flatpickr(el, {
    dateFormat: 'd/m/Y',
    locale: 'es',
    allowInput: true,
    disableMobile: true,
    ...opts
  });
}

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

// --- LOGIN REMOVED - App loads directly ---

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

  const titles = { agenda: 'Agenda', calendar: 'Calendario', team: 'Equipo', activity: 'Actividad', settings: 'Configuración' };
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
  if (view === 'activity') loadActivityLog();
  if (view === 'settings') renderSettingsPage();
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

// "Nueva tarea" now opens a creation modal
document.getElementById('add-task-regular').addEventListener('click', () => {
  addTaskMenu.classList.add('hidden');
  openNewTaskModal();
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

    // Only seed if database is completely empty (first deployment)
    if (tasks.length === 0) {
      try {
        await fetch('/api/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        [tasks, settings] = await Promise.all([
          api('GET', '/tasks'),
          api('GET', '/settings')
        ]);
      } catch {}
    }

    // Auto-delete completed tasks older than configured days
    await autoDeleteCompletedTasks();

    populateFilterDropdowns();
    renderTasks();
    renderTeam();
    updateStats();
    renderLeader();
    updateOverdueBadge();
    startPresencePolling();
    startSheetSyncPolling();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// Soft refresh: re-fetch data and re-render WITHOUT showing skeleton
async function softRefresh() {
  try {
    [tasks, settings] = await Promise.all([
      api('GET', '/tasks'),
      api('GET', '/settings')
    ]);
    await autoDeleteCompletedTasks();
    populateFilterDropdowns();
    renderTasks();
    renderTeam();
    updateStats();
    renderLeader();
    updateOverdueBadge();
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

async function autoDeleteCompletedTasks() {
  const days = settings.autoDeleteDays !== undefined ? settings.autoDeleteDays : 2;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const toDelete = tasks.filter(t => t.completedAt && new Date(t.completedAt).getTime() < cutoff);
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map(t => api('DELETE', `/tasks/${t.id}`)));
    tasks = tasks.filter(t => !toDelete.some(d => d.id === t.id));
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

function populateFormDataLists() {
  // No longer needed - modal dropdowns use getOptionsForField / getModalOptions dynamically
}

// --- MODAL CUSTOM SELECT DROPDOWN ---
let activeModalDropdown = null;

function getModalOptions(field) {
  if (field === 'timeoff-type') return ['Vacaciones', 'Day Off', 'OOO'];
  return getOptionsForField(field);
}

function openModalDropdown(selectEl) {
  closeModalDropdown();

  const field = selectEl.dataset.field;
  const currentValue = selectEl.dataset.value || '';
  const options = getModalOptions(field);
  const canAdd = ['client', 'assignee', 'supervisor', 'owner'].includes(field);

  const dropdown = document.getElementById('modal-dropdown');
  const searchInput = document.getElementById('modal-dropdown-search');
  const optionsContainer = document.getElementById('modal-dropdown-options');
  const addBtn = document.getElementById('modal-dropdown-add');

  selectEl.classList.add('open');

  // Position dropdown below the select
  const rect = selectEl.getBoundingClientRect();
  const dropdownMaxHeight = 280;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < dropdownMaxHeight && rect.top > dropdownMaxHeight) {
    dropdown.style.top = (rect.top - dropdownMaxHeight - 4) + 'px';
  } else {
    dropdown.style.top = (rect.bottom + 4) + 'px';
  }
  dropdown.style.left = rect.left + 'px';
  dropdown.style.minWidth = Math.max(rect.width, 200) + 'px';
  dropdown.style.maxWidth = Math.max(rect.width, 320) + 'px';

  searchInput.value = '';
  searchInput.placeholder = 'Buscar...';
  addBtn.classList.toggle('hidden', !canAdd);

  function renderOptions(filter) {
    const filtered = filter
      ? options.filter(o => o.toLowerCase().includes(filter.toLowerCase()))
      : options;

    optionsContainer.innerHTML = '';
    filtered.forEach(opt => {
      const div = document.createElement('div');
      div.className = 'edit-dropdown-option' + (opt === currentValue ? ' active' : '');
      div.innerHTML = '<span class="option-label">' + escHtml(opt) + '</span>';
      div.addEventListener('click', () => {
        selectModalValue(selectEl, opt);
      });
      optionsContainer.appendChild(div);
    });

    if (filtered.length === 0) {
      optionsContainer.innerHTML = '<div style="padding:.75rem;color:var(--text-muted);font-size:.85rem;text-align:center">Sin resultados</div>';
    }
  }

  renderOptions('');

  searchInput.oninput = () => renderOptions(searchInput.value);

  addBtn.onclick = () => {
    const newName = searchInput.value.trim();
    if (!newName) {
      toast('Escribí un nombre en el buscador', 'error');
      return;
    }
    selectModalValue(selectEl, newName);
    // Add to settings if appropriate
    if (field === 'client') {
      const color = getColorForName(newName);
      const bg = color + '18';
      if (!(settings.clients || []).some(c => c.name === newName)) {
        settings.clients = [...(settings.clients || []), { name: newName, color: bg, textColor: color }];
        api('PUT', '/settings', { clients: settings.clients }).catch(() => {});
      }
    } else if (['assignee', 'supervisor', 'owner'].includes(field)) {
      if (!(settings.teamMembers || []).some(m => m.name === newName)) {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        settings.teamMembers = [...(settings.teamMembers || []), { name: newName, color, role: 'Equipo' }];
        api('PUT', '/settings', { teamMembers: settings.teamMembers }).catch(() => {});
      }
    }
  };

  dropdown.classList.remove('hidden');
  searchInput.focus();

  activeModalDropdown = { dropdown, selectEl, field };
}

function selectModalValue(selectEl, value) {
  selectEl.dataset.value = value;
  selectEl.querySelector('.modal-select-text').textContent = value || selectEl.getAttribute('data-placeholder') || '';
  closeModalDropdown();
}

function closeModalDropdown() {
  const dropdown = document.getElementById('modal-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  if (activeModalDropdown) {
    activeModalDropdown.selectEl.classList.remove('open');
    activeModalDropdown = null;
  }
}

// Bind click to all modal-select elements
document.addEventListener('click', (e) => {
  const selectEl = e.target.closest('.modal-select');
  if (selectEl) {
    e.stopPropagation();
    if (activeModalDropdown && activeModalDropdown.selectEl === selectEl) {
      closeModalDropdown();
    } else {
      openModalDropdown(selectEl);
    }
    return;
  }
  // Close modal dropdown if clicking outside
  if (activeModalDropdown && !e.target.closest('#modal-dropdown')) {
    closeModalDropdown();
  }
});

// --- GET OPTIONS FOR DROPDOWN FIELDS (role-filtered) ---
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

  // Role-based filtering
  const equipoMembers = (settings.teamMembers || []).filter(m => !m.role || m.role === 'Equipo').map(m => m.name).sort();
  const ownerMembers = (settings.teamMembers || []).filter(m => m.role === 'Owner').map(m => m.name).sort();

  switch (field) {
    case 'client': return allClients;
    case 'assignee': return equipoMembers.length > 0 ? equipoMembers : allPeople;
    case 'supervisor': return allPeople;
    case 'owner': return ownerMembers.length > 0 ? ownerMembers : allPeople;
    case 'status': return STATUS_OPTIONS;
    case 'priority': return PRIORITY_CYCLE;
    default: return [];
  }
}

// --- RENDER TASKS ---
function getRegularTasks() {
  return tasks.filter(t => !t.isTimeOff && (t.client || '').toLowerCase() !== 'contrato');
}

function getContractTasks() {
  return tasks.filter(t => !t.isTimeOff && (t.client || '').toLowerCase() === 'contrato');
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

  // Separate completed and esperando
  const completedTasks = allFiltered.filter(t => t.status === 'completado');
  const esperandoTasks = allFiltered.filter(t => t.status === 'esperando respuesta');
  const regularFiltered = allFiltered.filter(t => t.status !== 'esperando respuesta' && t.status !== 'completado');

  container.innerHTML = '';

  if (regularFiltered.length === 0 && esperandoTasks.length === 0 && completedTasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons-round">inbox</span>
        <p>No hay tareas que mostrar</p>
      </div>`;
    return;
  }

  // Render active tasks first
  if (grouped) {
    renderGroupedTasks(container, regularFiltered);
  } else {
    const sorted = sortTasksByNumber(regularFiltered);
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.innerHTML = buildTaskTable(sorted);
    container.appendChild(wrapper);
    bindTaskRows(wrapper);

    const cards = buildMobileCards(sorted);
    container.appendChild(cards);
  }

  // Render esperando at bottom
  if (esperandoTasks.length > 0) {
    renderEsperandoSection(container, esperandoTasks);
  }

  // Render completed section at very bottom
  if (completedTasks.length > 0) {
    renderCompletedSection(container, completedTasks);
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

  // Drag from esperando
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

function renderCompletedSection(container, completedTasks) {
  const section = document.createElement('div');
  section.className = 'completed-section';

  const isCollapsed = collapsedGroups['__completed__'] === true; // visible by default

  const header = document.createElement('div');
  header.className = 'completed-header';
  header.innerHTML = `
    <span class="material-icons-round">check_circle</span>
    <span class="group-name">Completadas</span>
    <span class="group-count">${completedTasks.length} tarea${completedTasks.length !== 1 ? 's' : ''}</span>
    <span class="material-icons-round group-toggle ${isCollapsed ? 'collapsed' : ''}">expand_more</span>
  `;

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-wrapper';
  if (isCollapsed) tableWrapper.classList.add('hidden');
  const sorted = sortTasksByNumber(completedTasks);
  tableWrapper.innerHTML = buildTaskTable(sorted, true);

  const cards = buildMobileCards(sorted);
  if (isCollapsed) cards.classList.add('hidden');

  header.addEventListener('click', () => {
    const toggle = header.querySelector('.group-toggle');
    toggle.classList.toggle('collapsed');
    tableWrapper.classList.toggle('hidden');
    cards.classList.toggle('hidden');
    collapsedGroups['__completed__'] = tableWrapper.classList.contains('hidden');
    localStorage.setItem('agenda_collapsed', JSON.stringify(collapsedGroups));
  });

  section.appendChild(header);
  section.appendChild(tableWrapper);
  section.appendChild(cards);
  container.appendChild(section);
  bindTaskRows(tableWrapper);
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
  const allContracts = getContractTasks();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Add members who only have timeoff or contract entries (no regular tasks)
  [...timeOffs, ...allContracts].forEach(t => {
    const key = t.assignee || 'Sin asignar';
    if (!groups[key]) {
      groups[key] = [];
      sortedKeys.push(key);
    }
  });
  // Re-sort after adding new keys
  sortedKeys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  sortedKeys.forEach((assignee) => {
    const groupTasks = sortTasksByNumber(groups[assignee]);
    const member = (settings.teamMembers || []).find(m => m.name === assignee);
    const color = member?.color || getColorForName(assignee);
    const initials = member?.initials || getInitials(assignee);

    const memberTimeOffs = timeOffs.filter(to => to.assignee === assignee);
    const memberContracts = getContractTasks().filter(c => c.assignee === assignee);

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
        const label = to.timeOffTitle || to.timeOffType || 'Time Off';
        timeoffHtml += `<span class="timeoff-badge" data-id="${to.id}" title="${escAttr(to.timeOffTitle || to.timeOffType || 'Time Off')}">
          <span class="material-icons-round">beach_access</span>
          ${escHtml(label)}: ${start} - ${end}
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

    let contractHtml = '';
    if (memberContracts.length > 0) {
      memberContracts.forEach(ct => {
        const deadlineClass = ct.deadline ? getDeadlineClass(ct.deadline) : '';
        const dateStr = ct.deadline ? formatDate(ct.deadline) : 'Sin fecha';
        contractHtml += `<span class="contrato-badge ${deadlineClass}" data-id="${ct.id}" title="Contrato hasta ${dateStr}">
          <span class="material-icons-round">description</span>
          Contrato: ${dateStr}
        </span>`;
      });
    }

    header.innerHTML = `
      <span class="material-icons-round drag-handle">drag_indicator</span>
      <div class="group-avatar" style="background:${color}">${initials}</div>
      <span class="group-name">${escHtml(assignee)}</span>
      <span class="group-count">${groupTasks.length} tarea${groupTasks.length !== 1 ? 's' : ''}</span>
      ${overdueHtml}
      ${timeoffHtml}
      ${contractHtml}
      <span class="material-icons-round group-toggle ${isCollapsed ? 'collapsed' : ''}">expand_more</span>
    `;

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    if (isCollapsed) tableWrapper.classList.add('hidden');
    tableWrapper.innerHTML = buildTaskTable(groupTasks, false, assignee);

    const cards = buildMobileCards(groupTasks, assignee);
    if (isCollapsed) cards.classList.add('hidden');

    // Supervisor linked tasks: tasks this person supervises from other assignees
    const supervisedTasks = getRegularTasks().filter(t =>
      t.supervisor === assignee &&
      t.assignee !== assignee &&
      t.status !== 'completado' &&
      t.status !== 'esperando respuesta'
    );

    let supervisedSection = null;
    if (supervisedTasks.length > 0) {
      supervisedSection = document.createElement('div');
      supervisedSection.className = 'supervised-section';
      if (isCollapsed) supervisedSection.classList.add('hidden');

      const supKey = `__sup_${assignee}`;
      const isSupCollapsed = collapsedGroups[supKey] === true; // visible by default

      supervisedSection.innerHTML = `
        <div class="supervised-header" data-sup-key="${escAttr(supKey)}">
          <span class="material-icons-round supervised-eye">${isSupCollapsed ? 'visibility_off' : 'visibility'}</span>
          Supervisando (${supervisedTasks.length} tarea${supervisedTasks.length !== 1 ? 's' : ''} de otros equipos)
        </div>
        <div class="supervised-items ${isSupCollapsed ? 'hidden' : ''}"></div>
      `;

      const itemsContainer = supervisedSection.querySelector('.supervised-items');
      supervisedTasks.forEach(t => {
        const clientColor = getClientColor(t.client);
        const statusClass = (t.status || '').toLowerCase().replace(/ /g, '-');
        const item = document.createElement('div');
        item.className = 'supervised-item';
        item.dataset.taskId = t.id;
        item.innerHTML = `
          <span class="client-badge" style="background:${clientColor.bg};color:${clientColor.text};font-size:.7rem;padding:.1rem .35rem">${escHtml(t.client || '—')}</span>
          <span>${escHtml(t.project || 'Sin proyecto')}</span>
          <span class="status-badge ${statusClass}" style="font-size:.65rem">${escHtml(t.status || '—')}</span>
          <span class="supervised-assignee">\u2192 ${escHtml(t.assignee)}</span>
        `;
        item.addEventListener('click', () => navigateToTask(t.id));
        itemsContainer.appendChild(item);
      });

      // Toggle supervised items on eye icon click
      const supHeader = supervisedSection.querySelector('.supervised-header');
      supHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        const supItemsDiv = supervisedSection.querySelector('.supervised-items');
        const eyeIcon = supHeader.querySelector('.supervised-eye');
        supItemsDiv.classList.toggle('hidden');
        const nowHidden = supItemsDiv.classList.contains('hidden');
        eyeIcon.textContent = nowHidden ? 'visibility_off' : 'visibility';
        collapsedGroups[supKey] = nowHidden;
        localStorage.setItem('agenda_collapsed', JSON.stringify(collapsedGroups));
      });
    }

    // Toggle collapse
    header.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle') || e.target.closest('.timeoff-badge') || e.target.closest('.contrato-badge')) return;
      const toggle = header.querySelector('.group-toggle');
      toggle.classList.toggle('collapsed');
      tableWrapper.classList.toggle('hidden');
      cards.classList.toggle('hidden');
      if (supervisedSection) supervisedSection.classList.toggle('hidden');
      collapsedGroups[assignee] = tableWrapper.classList.contains('hidden');
      localStorage.setItem('agenda_collapsed', JSON.stringify(collapsedGroups));
    });

    // Time off badge click - open inline editor (same as contract)
    header.querySelectorAll('.timeoff-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const toTask = tasks.find(t => t.id === badge.dataset.id);
        if (toTask) openTimeOffEditor(badge, toTask);
      });
    });

    // Contract badge click - open inline editor
    header.querySelectorAll('.contrato-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = badge.dataset.id;
        const ct = tasks.find(t => t.id === taskId);
        if (!ct) return;
        openContractEditor(badge, ct);
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
    if (supervisedSection) container.appendChild(supervisedSection);
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
        <td class="editable-cell" data-field="taskNumber" style="color:var(--text-muted);font-size:.8rem">${escHtml(t.taskNumber || '')}</td>
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

    card.querySelector('.task-action-btn.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar esta tarea?')) return;
      try {
        await api('DELETE', `/tasks/${t.id}`);
        logActivity('delete', t.id, '', '', '', `${t.client || ''} - ${t.project || ''}`);
        toast('Tarea eliminada');
        await softRefresh();
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    });

    card.querySelector('.task-action-btn.copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyingTaskId = t.id;
      setModalSelect('copy-assignee', '');
      document.getElementById('copy-modal').classList.remove('hidden');
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
    cell.addEventListener('mouseenter', () => {
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
      const deletedTask = tasks.find(t => t.id === taskId);
      try {
        await api('DELETE', `/tasks/${taskId}`);
        logActivity('delete', taskId, '', '', '', `${deletedTask?.client || ''} - ${deletedTask?.project || ''}`);
        toast('Tarea eliminada');
        await softRefresh();
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
      setModalSelect('copy-assignee', '');
      document.getElementById('copy-modal').classList.remove('hidden');
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

// --- QUICK ADD TASK (now opens modal with pre-filled assignee) ---
function quickAddTask(assignee) {
  openNewTaskModal(assignee);
}

// --- INLINE EDITING (with toggle fix) ---
function startInlineEdit(cell, task, field) {
  // FIX: If clicking the same cell that already has an active dropdown, close it
  if (activeEditDropdown && activeEditDropdown.cell === cell) {
    closeEditDropdown();
    return;
  }
  // FIX: If clicking the same cell that already has an active text input, do nothing
  if (activeInlineInput && activeInlineInput.cell === cell) {
    return;
  }

  closeEditDropdown();
  closeInlineInput();

  // Report presence
  reportPresence(task.id, field);

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
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-edit-input';
  input.value = currentValue;
  input.placeholder = field === 'comments' ? 'Agregar comentario...' : field === 'taskNumber' ? '#' : 'Escribir...';

  const originalHtml = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(input);

  // Add supervision toggle if editing project field
  let supervisionCheckbox = null;
  if (field === 'project') {
    const wrap = document.createElement('label');
    wrap.className = 'supervision-inline-wrap';
    supervisionCheckbox = document.createElement('input');
    supervisionCheckbox.type = 'checkbox';
    supervisionCheckbox.checked = task.isSupervision || false;
    wrap.appendChild(supervisionCheckbox);
    wrap.appendChild(document.createTextNode(' Supervisión'));
    cell.appendChild(wrap);
    // Prevent checkbox click from bubbling to cell
    wrap.addEventListener('click', (e) => e.stopPropagation());
  }

  input.focus();
  input.select();

  activeInlineInput = { cell, originalHtml, input };

  const save = async () => {
    const newValue = input.value.trim();
    const update = {};
    let changed = false;

    if (newValue !== currentValue) {
      update[field] = newValue;
      changed = true;
    }

    // Check supervision toggle
    if (supervisionCheckbox && supervisionCheckbox.checked !== (task.isSupervision || false)) {
      update.isSupervision = supervisionCheckbox.checked;
      changed = true;
    }

    if (changed) {
      try {
        await api('PUT', `/tasks/${task.id}`, update);
        if (update[field] !== undefined) {
          pushUndo(task.id, field, currentValue, newValue);
          logActivity('update', task.id, field, currentValue, newValue, `${task.client || ''} - ${task.project || ''}`);
          task[field] = newValue;
        }
        if (update.isSupervision !== undefined) {
          task.isSupervision = update.isSupervision;
        }
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }
    closeInlineInput();
    clearPresence();
    renderTasks();
    updateStats();
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
  input.type = 'text';
  input.className = 'cell-edit-input';
  input.value = isoToDDMMYYYY(currentValue);
  input.placeholder = 'DD/MM/YYYY';

  cell.innerHTML = '';
  cell.appendChild(input);

  activeInlineInput = { cell, originalHtml, input };

  const save = async () => {
    const raw = input.value.trim();
    const newValue = raw ? parseDDMMYYYY(raw) : '';
    if (raw && !newValue) {
      toast('Formato inválido, usá DD/MM/YYYY', 'error');
      closeInlineInput();
      cell.innerHTML = originalHtml;
      return;
    }
    if (newValue !== currentValue) {
      try {
        await api('PUT', `/tasks/${task.id}`, { deadline: newValue });
        pushUndo(task.id, 'deadline', currentValue, newValue);
        logActivity('update', task.id, 'deadline', currentValue, newValue, `${task.client || ''} - ${task.project || ''}`);
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

  const fp = initDatePicker(input, {
    defaultDate: currentValue ? isoToDDMMYYYY(currentValue) : undefined,
    onChange(selectedDates, dateStr) {
      input.value = dateStr;
    },
    onClose() {
      setTimeout(() => {
        if (activeInlineInput && activeInlineInput.input === input) save();
      }, 100);
    }
  });
  fp.open();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { fp.close(); save(); }
    if (e.key === 'Escape') { fp.close(); closeInlineInput(); clearPresence(); cell.innerHTML = originalHtml; }
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
  dropdown.style.left = rect.left + 'px';
  dropdown.style.minWidth = Math.max(rect.width, 200) + 'px';

  // Flip dropdown above cell if near bottom of viewport
  const dropdownMaxHeight = 320;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < dropdownMaxHeight && rect.top > dropdownMaxHeight) {
    dropdown.style.top = (rect.top - dropdownMaxHeight - 4) + 'px';
    dropdown.style.maxHeight = dropdownMaxHeight + 'px';
  } else {
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = Math.min(dropdownMaxHeight, spaceBelow - 8) + 'px';
  }

  // Adjust if off-screen horizontally
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
        settings.teamMembers = [...(settings.teamMembers || []), { name: newName, color, role: 'Equipo' }];
        if (field === 'assignee' && !(settings.assigneeOrder || []).includes(newName)) {
          settings.assigneeOrder = [...(settings.assigneeOrder || []), newName];
        }
        api('PUT', '/settings', { teamMembers: settings.teamMembers, assigneeOrder: settings.assigneeOrder }).catch(() => {});
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

    // Handle completedAt for status changes
    if (field === 'status') {
      if (value === 'completado') {
        update.completedAt = new Date().toISOString();
      } else if (task.status === 'completado') {
        update.completedAt = null;
      }
    }

    await api('PUT', `/tasks/${task.id}`, update);
    pushUndo(task.id, field, previousValue, value);
    task[field] = value;
    if (update.completedAt !== undefined) task.completedAt = update.completedAt;

    logActivity('update', task.id, field, previousValue, value, `${task.client || ''} - ${task.project || ''}`);

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

// --- CONTRACT BADGE EDITOR ---
function openContractEditor(badgeEl, contractTask) {
  // Close any existing contract editor
  document.querySelectorAll('.contrato-editor-popup').forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = 'contrato-editor-popup';
  popup.innerHTML = `
    <div class="contrato-editor-header">
      <span style="font-weight:600;font-size:.85rem">Contrato - ${escHtml(contractTask.assignee)}</span>
    </div>
    <div class="contrato-editor-body">
      <label style="font-size:.8rem;color:var(--text-secondary)">Fecha de vencimiento</label>
      <input type="text" class="contrato-date-input" value="${isoToDDMMYYYY(contractTask.deadline)}" placeholder="DD/MM/YYYY">
    </div>
    <div class="contrato-editor-actions">
      <button class="btn btn-ghost btn-xs contrato-delete-btn" style="color:#ef4444">
        <span class="material-icons-round" style="font-size:.9rem">delete</span> Eliminar
      </button>
      <button class="btn btn-ghost btn-xs contrato-cancel-btn">Cancelar</button>
      <button class="btn btn-primary btn-xs contrato-save-btn">
        <span class="material-icons-round" style="font-size:.9rem">check</span> Guardar
      </button>
    </div>
  `;

  // Position near the badge (absolute so it scrolls with content)
  const rect = badgeEl.getBoundingClientRect();
  popup.style.position = 'absolute';
  popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  popup.style.left = (rect.left + window.scrollX) + 'px';
  popup.style.zIndex = '9999';
  document.body.appendChild(popup);

  // Keep popup in viewport
  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      popup.style.left = (window.innerWidth - popupRect.width - 8 + window.scrollX) + 'px';
    }
  });

  // Init date picker on contract date input
  initDatePicker(popup.querySelector('.contrato-date-input'));

  // Cancel handler
  popup.querySelector('.contrato-cancel-btn').addEventListener('click', () => {
    popup.remove();
  });

  // Save handler
  popup.querySelector('.contrato-save-btn').addEventListener('click', async () => {
    const raw = popup.querySelector('.contrato-date-input').value.trim();
    const newDate = raw ? parseDDMMYYYY(raw) : '';
    if (raw && !newDate) { toast('Formato inválido, usá DD/MM/YYYY', 'error'); return; }
    try {
      await api('PUT', `/tasks/${contractTask.id}`, { deadline: newDate });
      contractTask.deadline = newDate;
      toast('Contrato actualizado');
      popup.remove();
      renderTasks();
      updateStats();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });

  // Delete handler
  popup.querySelector('.contrato-delete-btn').addEventListener('click', async () => {
    if (!confirm('¿Eliminar este contrato?')) return;
    try {
      await api('DELETE', `/tasks/${contractTask.id}`);
      tasks = tasks.filter(t => t.id !== contractTask.id);
      toast('Contrato eliminado');
      popup.remove();
      renderTasks();
      updateStats();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });

  // Close on outside click
  const closeOnOutside = (e) => {
    if (!popup.contains(e.target) && !badgeEl.contains(e.target)) {
      popup.remove();
      document.removeEventListener('click', closeOnOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside, true), 10);
}

// --- TIME OFF BADGE EDITOR ---
function openTimeOffEditor(badgeEl, toTask) {
  // Close any existing popups
  document.querySelectorAll('.contrato-editor-popup').forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = 'contrato-editor-popup';
  popup.innerHTML = `
    <div class="contrato-editor-header">
      <span style="font-weight:600;font-size:.85rem">${escHtml(toTask.timeOffType || 'Time Off')} - ${escHtml(toTask.assignee)}</span>
    </div>
    <div class="contrato-editor-body">
      <label style="font-size:.8rem;color:var(--text-secondary)">Título / Descripción</label>
      <input type="text" class="contrato-date-input timeoff-title-input" value="${escAttr(toTask.timeOffTitle || '')}" placeholder="Ej: Vacaciones...">
      <label style="font-size:.8rem;color:var(--text-secondary);margin-top:.35rem">Tipo</label>
      <select class="contrato-date-input timeoff-type-select">
        <option value="Vacaciones" ${toTask.timeOffType === 'Vacaciones' ? 'selected' : ''}>Vacaciones</option>
        <option value="Day Off" ${toTask.timeOffType === 'Day Off' ? 'selected' : ''}>Day Off</option>
        <option value="OOO" ${toTask.timeOffType === 'OOO' ? 'selected' : ''}>OOO</option>
      </select>
      <label style="font-size:.8rem;color:var(--text-secondary);margin-top:.35rem">Desde</label>
      <input type="text" class="contrato-date-input timeoff-start-input" value="${isoToDDMMYYYY(toTask.timeOffStart)}" placeholder="DD/MM/YYYY">
      <label style="font-size:.8rem;color:var(--text-secondary);margin-top:.35rem">Hasta</label>
      <input type="text" class="contrato-date-input timeoff-end-input" value="${isoToDDMMYYYY(toTask.timeOffEnd)}" placeholder="DD/MM/YYYY">
    </div>
    <div class="contrato-editor-actions">
      <button class="btn btn-ghost btn-xs timeoff-popup-delete" style="color:#ef4444">
        <span class="material-icons-round" style="font-size:.9rem">delete</span> Eliminar
      </button>
      <button class="btn btn-ghost btn-xs timeoff-popup-cancel">Cancelar</button>
      <button class="btn btn-primary btn-xs timeoff-popup-save">
        <span class="material-icons-round" style="font-size:.9rem">check</span> Guardar
      </button>
    </div>
  `;

  const rect = badgeEl.getBoundingClientRect();
  popup.style.position = 'absolute';
  popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  popup.style.left = (rect.left + window.scrollX) + 'px';
  popup.style.zIndex = '9999';
  document.body.appendChild(popup);

  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      popup.style.left = (window.innerWidth - popupRect.width - 8 + window.scrollX) + 'px';
    }
  });

  // Init date pickers on time off date inputs
  initDatePicker(popup.querySelector('.timeoff-start-input'));
  initDatePicker(popup.querySelector('.timeoff-end-input'));

  // Cancel
  popup.querySelector('.timeoff-popup-cancel').addEventListener('click', () => {
    popup.remove();
  });

  // Save
  popup.querySelector('.timeoff-popup-save').addEventListener('click', async () => {
    const title = popup.querySelector('.timeoff-title-input').value.trim();
    const type = popup.querySelector('.timeoff-type-select').value;
    const startRaw = popup.querySelector('.timeoff-start-input').value.trim();
    const endRaw = popup.querySelector('.timeoff-end-input').value.trim();
    const start = startRaw ? parseDDMMYYYY(startRaw) : '';
    const end = endRaw ? parseDDMMYYYY(endRaw) : '';
    if (!start || !end) { toast('Completá las fechas (DD/MM/YYYY)', 'error'); return; }
    const body = {
      timeOffTitle: title,
      timeOffType: type,
      timeOffStart: start,
      timeOffEnd: end,
      deadline: end,
      project: type,
      comments: title ? `${title} - ${type}: ${start} - ${end}` : `${type}: ${start} - ${end}`
    };
    try {
      await api('PUT', `/tasks/${toTask.id}`, body);
      Object.assign(toTask, body);
      toast('Time off actualizado');
      popup.remove();
      renderTasks();
      updateStats();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });

  // Delete
  popup.querySelector('.timeoff-popup-delete').addEventListener('click', async () => {
    if (!confirm('¿Eliminar este time off?')) return;
    try {
      await api('DELETE', `/tasks/${toTask.id}`);
      tasks = tasks.filter(t => t.id !== toTask.id);
      toast('Time off eliminado');
      popup.remove();
      renderTasks();
      updateStats();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });

  // Close on outside click
  const closeOnOutside = (e) => {
    if (!popup.contains(e.target) && !badgeEl.contains(e.target)) {
      popup.remove();
      document.removeEventListener('click', closeOnOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside, true), 10);
}

// --- LEADER OF THE WEEK (uses leaderPool) ---
function renderLeader() {
  const nameEl = document.getElementById('leader-name');
  const leader = settings.weeklyLeader;
  nameEl.textContent = leader || '—';
}

document.getElementById('leader-randomize').addEventListener('click', async () => {
  // Use leaderPool if set, otherwise all team members
  const pool = (settings.leaderPool || []).length > 0
    ? settings.leaderPool
    : (settings.teamMembers || []).map(m => m.name);

  if (pool.length === 0) {
    toast('Agregá miembros al equipo primero', 'error');
    return;
  }

  const nameEl = document.getElementById('leader-name');
  let count = 0;
  const interval = setInterval(() => {
    nameEl.textContent = pool[Math.floor(Math.random() * pool.length)];
    count++;
    if (count >= 15) {
      clearInterval(interval);
      const winner = pool[Math.floor(Math.random() * pool.length)];
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
  const newAssignee = getModalSelect('copy-assignee');
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
    await softRefresh();
  } catch (err) {
    toast('Error al copiar: ' + err.message, 'error');
  }
});

// --- TIME OFF MODAL (with title field) ---
function openTimeOffModal(entry = null) {
  editingTimeOffId = entry ? entry.id : null;
  const titleEl = document.getElementById('timeoff-modal-title');
  titleEl.textContent = entry ? 'Editar Time Off' : 'Time Off';
  document.getElementById('timeoff-delete').classList.toggle('hidden', !entry);

  setModalSelect('timeoff-member', entry?.assignee || '');
  document.getElementById('timeoff-title').value = entry?.timeOffTitle || '';
  document.getElementById('timeoff-start').value = isoToDDMMYYYY(entry?.timeOffStart || '');
  document.getElementById('timeoff-end').value = isoToDDMMYYYY(entry?.timeOffEnd || '');
  setModalSelect('timeoff-type', entry?.timeOffType || 'Vacaciones');

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
  const member = getModalSelect('timeoff-member');
  const title = document.getElementById('timeoff-title').value.trim();
  const startRaw = document.getElementById('timeoff-start').value.trim();
  const endRaw = document.getElementById('timeoff-end').value.trim();
  const start = startRaw ? parseDDMMYYYY(startRaw) : '';
  const end = endRaw ? parseDDMMYYYY(endRaw) : '';
  const type = getModalSelect('timeoff-type');

  if (!member || !start || !end) {
    toast('Completá todos los campos (fechas en DD/MM/YYYY)', 'error');
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
    comments: title ? `${title} - ${type}: ${start} - ${end}` : `${type}: ${start} - ${end}`,
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
    await softRefresh();
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
    await softRefresh();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// --- MODAL SELECT HELPERS ---
function setModalSelect(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.value = value;
  const textEl = el.querySelector('.modal-select-text');
  if (textEl) textEl.textContent = value || el.getAttribute('data-placeholder') || getModalSelectPlaceholder(id);
}

function getModalSelect(id) {
  const el = document.getElementById(id);
  return el ? (el.dataset.value || '').trim() : '';
}

function getModalSelectPlaceholder(id) {
  const map = {
    'new-task-client': 'Seleccionar cliente...',
    'new-task-assignee': 'Miembro del equipo...',
    'new-task-supervisor': 'Supervisor...',
    'new-task-priority': 'TBD',
    'new-task-status': 'Sin empezar',
    'new-task-owner': 'Owner...',
    'timeoff-member': 'Seleccioná...',
    'timeoff-type': 'Vacaciones',
    'copy-assignee': 'Seleccioná...'
  };
  return map[id] || 'Seleccionar...';
}

// --- NEW TASK CREATION MODAL ---
function openNewTaskModal(prefillAssignee = '') {
  setModalSelect('new-task-client', '');
  document.getElementById('new-task-project').value = '';
  setModalSelect('new-task-assignee', prefillAssignee);
  setModalSelect('new-task-supervisor', '');
  setModalSelect('new-task-priority', 'TBD');
  document.getElementById('new-task-deadline').value = '';
  setModalSelect('new-task-status', 'sin empezar');
  setModalSelect('new-task-owner', '');
  document.getElementById('new-task-comments').value = '';
  document.getElementById('new-task-supervision').checked = false;

  document.getElementById('new-task-modal').classList.remove('hidden');
}

function closeNewTaskModal() {
  document.getElementById('new-task-modal').classList.add('hidden');
}

document.getElementById('new-task-modal-close').addEventListener('click', closeNewTaskModal);
document.getElementById('new-task-cancel').addEventListener('click', closeNewTaskModal);
document.getElementById('new-task-modal').querySelector('.modal-backdrop').addEventListener('click', closeNewTaskModal);

document.getElementById('new-task-save').addEventListener('click', async () => {
  const client = getModalSelect('new-task-client');
  const project = document.getElementById('new-task-project').value.trim();
  const assignee = getModalSelect('new-task-assignee');
  const supervisor = getModalSelect('new-task-supervisor');
  const priority = getModalSelect('new-task-priority');
  const deadlineRaw = document.getElementById('new-task-deadline').value.trim();
  const deadline = deadlineRaw ? parseDDMMYYYY(deadlineRaw) : '';
  if (deadlineRaw && !deadline) { toast('Formato de fecha inválido, usá DD/MM/YYYY', 'error'); return; }
  const status = getModalSelect('new-task-status');
  const owner = getModalSelect('new-task-owner');
  const comments = document.getElementById('new-task-comments').value.trim();
  const isSupervision = document.getElementById('new-task-supervision').checked;

  if (!client && !project) {
    toast('Completá al menos un cliente o proyecto', 'error');
    return;
  }

  const body = { client, project, assignee, supervisor, priority, deadline, status, owner, comments, isSupervision };

  try {
    const created = await api('POST', '/tasks', body);
    logActivity('create', created.id, '', '', '', `${client} - ${project}`);
    toast('Tarea creada');
    closeNewTaskModal();
    await softRefresh();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// --- CALENDAR VIEW (with assignee filters and clickable events) ---
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
  saveCalFilters();
  renderCalendar();
});

document.getElementById('cal-filter-timeoff').addEventListener('click', (e) => {
  calFilters.timeoff = !calFilters.timeoff;
  e.currentTarget.classList.toggle('active', calFilters.timeoff);
  saveCalFilters();
  renderCalendar();
});

document.getElementById('cal-all-on').addEventListener('click', () => {
  Object.keys(calAssigneeFilters).forEach(k => calAssigneeFilters[k] = true);
  saveCalFilters();
  renderCalendar();
});

document.getElementById('cal-all-off').addEventListener('click', () => {
  Object.keys(calAssigneeFilters).forEach(k => calAssigneeFilters[k] = false);
  saveCalFilters();
  renderCalendar();
});

function renderCalendarAssigneeFilters() {
  const container = document.getElementById('cal-assignee-filters');
  const allAssignees = [...new Set([
    ...(settings.teamMembers || []).map(m => m.name),
    ...tasks.map(t => t.assignee).filter(Boolean)
  ])].sort();

  container.innerHTML = '';
  allAssignees.forEach(name => {
    if (calAssigneeFilters[name] === undefined) calAssigneeFilters[name] = true;
    const member = (settings.teamMembers || []).find(m => m.name === name);
    const color = member?.color || getColorForName(name);

    const chip = document.createElement('button');
    chip.className = `cal-assignee-chip ${calAssigneeFilters[name] ? 'active' : ''}`;
    chip.innerHTML = `<span class="chip-dot" style="background:${color}"></span>${escHtml(name)}`;
    chip.addEventListener('click', () => {
      calAssigneeFilters[name] = !calAssigneeFilters[name];
      chip.classList.toggle('active', calAssigneeFilters[name]);
      saveCalFilters();
      renderCalendar();
    });
    container.appendChild(chip);
  });
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const titleEl = document.getElementById('cal-month-title');

  // Sync filter button states from persisted state
  document.getElementById('cal-filter-deadlines').classList.toggle('active', calFilters.deadlines);
  document.getElementById('cal-filter-timeoff').classList.toggle('active', calFilters.timeoff);

  // Render assignee filter chips
  renderCalendarAssigneeFilters();

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
    // Include both regular tasks and contract tasks on calendar
    [...getRegularTasks(), ...getContractTasks()].forEach(t => {
      if (!t.deadline) return;
      // Apply assignee filter
      if (t.assignee && calAssigneeFilters[t.assignee] === false) return;
      if (!deadlineMap[t.deadline]) deadlineMap[t.deadline] = [];
      deadlineMap[t.deadline].push(t);
    });
  }

  if (calFilters.timeoff) {
    getTimeOffEntries().forEach(to => {
      if (!to.timeOffStart || !to.timeOffEnd) return;
      // Apply assignee filter
      if (to.assignee && calAssigneeFilters[to.assignee] === false) return;
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

    timeoffs.forEach(to => {
      const memberObj = (settings.teamMembers || []).find(m => m.name === to.assignee);
      const color = memberObj?.color || getColorForName(to.assignee);
      const typeLabel = to.timeOffType === 'OOO' ? 'OOO' : to.timeOffType === 'Day Off' ? 'Day Off' : 'Vac';
      const pos = to._pos || 'single';
      const showLabel = pos === 'start' || pos === 'single';
      const displayLabel = to.timeOffTitle || `${to.assignee} (${typeLabel})`;
      eventsHtml += `<div class="calendar-event timeoff timeoff-${pos}" style="background:${color}" title="${escAttr(displayLabel)}" data-task-id="${to.id}" data-event-type="timeoff">
        ${showLabel ? `<span class="material-icons-round">beach_access</span>${escHtml(displayLabel)}` : '&nbsp;'}
      </div>`;
    });

    deadlines.forEach(t => {
      const isOverdue = new Date(dateStr + 'T00:00:00') < today && t.status !== 'completado';
      const cls = isOverdue ? 'deadline-overdue' : 'deadline';
      eventsHtml += `<div class="calendar-event ${cls}" title="${escAttr(t.project)} - ${escAttr(t.assignee)}" data-task-id="${t.id}" data-event-type="deadline">
        <span class="material-icons-round">flag</span>${escHtml(t.project || t.client)}
      </div>`;
    });

    eventsHtml += '</div>';

    html += `<div class="${classes.join(' ')}">
      <div class="calendar-day-number">${dayNum}</div>
      ${eventsHtml}
    </div>`;
  }

  grid.innerHTML = html;

  // Bind click events on calendar events
  grid.querySelectorAll('.calendar-event[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = el.dataset.taskId;
      const type = el.dataset.eventType;
      if (type === 'timeoff') {
        const toTask = tasks.find(t => t.id === taskId);
        if (toTask) openTimeOffModal(toTask);
      } else {
        openCalEventModal(taskId);
      }
    });
  });
}

// --- CALENDAR EVENT EDIT MODAL ---
function openCalEventModal(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  calEventEditData = { taskId };

  document.getElementById('cal-event-title').textContent = 'Editar deadline';
  document.getElementById('cal-event-info').textContent = `${task.project || task.client} \u2192 ${task.assignee || 'Sin asignar'}`;
  document.getElementById('cal-event-label').textContent = 'Deadline';
  document.getElementById('cal-event-date').value = isoToDDMMYYYY(task.deadline);
  document.getElementById('cal-event-modal').classList.remove('hidden');
}

function closeCalEventModal() {
  document.getElementById('cal-event-modal').classList.add('hidden');
  calEventEditData = null;
}

document.getElementById('cal-event-close').addEventListener('click', closeCalEventModal);
document.getElementById('cal-event-cancel').addEventListener('click', closeCalEventModal);
document.getElementById('cal-event-modal').querySelector('.modal-backdrop').addEventListener('click', closeCalEventModal);

document.getElementById('cal-event-save').addEventListener('click', async () => {
  if (!calEventEditData) return;
  const { taskId } = calEventEditData;
  const raw = document.getElementById('cal-event-date').value.trim();
  const newDate = raw ? parseDDMMYYYY(raw) : '';
  if (raw && !newDate) { toast('Formato inválido, usá DD/MM/YYYY', 'error'); return; }
  try {
    await api('PUT', `/tasks/${taskId}`, { deadline: newDate });
    const task = tasks.find(t => t.id === taskId);
    if (task) task.deadline = newDate;
    toast('Fecha actualizada');
    closeCalEventModal();
    renderCalendar();
    renderTasks();
    updateStats();
    updateOverdueBadge();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

document.getElementById('cal-event-delete').addEventListener('click', async () => {
  if (!calEventEditData) return;
  if (!confirm('¿Eliminar este evento/tarea?')) return;
  try {
    await api('DELETE', `/tasks/${calEventEditData.taskId}`);
    toast('Evento eliminado');
    closeCalEventModal();
    await softRefresh();
    renderCalendar();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

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
      const type = nextTo.timeOffTitle || nextTo.timeOffType || 'Time Off';
      timeoffInfo = `<div class="member-timeoff-info">
        <span class="material-icons-round">beach_access</span>
        ${escHtml(type)}: ${formatDate(nextTo.timeOffStart)} - ${formatDate(nextTo.timeOffEnd)}
      </div>`;
    }

    const initials = member.initials || getInitials(member.name);
    const roleLabel = member.role || 'Equipo';

    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-avatar" style="background:${member.color || getColorForName(member.name)}">${initials}</div>
      <div class="member-info">
        <h3>${escHtml(member.name)}</h3>
        <p>${escHtml(roleLabel)}</p>
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
      if (!confirm(`¿Eliminar a ${name} del equipo? Se quitará de todas las tareas asignadas.`)) return;
      settings.teamMembers = settings.teamMembers.filter(m => m.name !== name);
      // Also remove from assigneeOrder and leaderPool
      settings.assigneeOrder = (settings.assigneeOrder || []).filter(n => n !== name);
      settings.leaderPool = (settings.leaderPool || []).filter(n => n !== name);
      try {
        await api('PUT', '/settings', { teamMembers: settings.teamMembers, assigneeOrder: settings.assigneeOrder, leaderPool: settings.leaderPool });
        // Clear assignee from all tasks where this person is assigned
        const updatePromises = [];
        tasks.forEach(t => {
          const updates = {};
          if (t.assignee === name) { updates.assignee = ''; t.assignee = ''; }
          if (t.supervisor === name) { updates.supervisor = ''; t.supervisor = ''; }
          if (t.owner === name) { updates.owner = ''; t.owner = ''; }
          if (Object.keys(updates).length > 0) {
            updatePromises.push(api('PUT', `/tasks/${t.id}`, updates));
          }
        });
        await Promise.all(updatePromises);
        renderTeam();
        populateFilterDropdowns();
        renderTasks();
        updateStats();
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
      <button class="tag-edit" data-name="${escAttr(client.name)}" title="Editar">
        <span class="material-icons-round">edit</span>
      </button>
      <button class="tag-delete" data-name="${escAttr(client.name)}" title="Eliminar">
        <span class="material-icons-round">close</span>
      </button>
    `;
    clientsList.appendChild(tag);
  });

  clientsList.querySelectorAll('.tag-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const client = (settings.clients || []).find(c => c.name === name);
      if (!client) return;
      openPromptModal('Editar cliente', 'Nombre del cliente', true, false, async ({ name: newName, color }) => {
        const idx = settings.clients.findIndex(c => c.name === name);
        if (idx === -1) return;
        const bg = color + '18';
        const oldName = client.name;
        settings.clients[idx] = { name: newName, color: bg, textColor: color };
        try {
          await api('PUT', '/settings', { clients: settings.clients });
          if (oldName !== newName) {
            const updatePromises = [];
            tasks.forEach(t => {
              if (t.client === oldName) {
                updatePromises.push(api('PUT', `/tasks/${t.id}`, { client: newName }));
                t.client = newName;
              }
            });
            await Promise.all(updatePromises);
          }
          await softRefresh();
          toast('Cliente actualizado');
        } catch (err) {
          toast('Error: ' + err.message, 'error');
        }
      });
      // Pre-select the current color
      setTimeout(() => {
        const colorsDiv = document.getElementById('prompt-modal-colors');
        colorsDiv.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        const matchSwatch = colorsDiv.querySelector(`[data-color="${client.textColor}"]`);
        if (matchSwatch) matchSwatch.classList.add('selected');
        document.getElementById('prompt-modal-input').value = client.name;
      }, 50);
    });
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

  document.getElementById('prompt-modal-role').value = member.role || 'Equipo';

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

      await softRefresh();
      toast('Miembro actualizado');
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
  const role = document.getElementById('prompt-modal-role').value;
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
    settings.teamMembers = [...(settings.teamMembers || []), { name, color, role: role || 'Equipo', initials: initialsVal || getInitials(name) }];
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

// --- SETTINGS PAGE ---
function renderSettingsPage() {
  renderLeaderPool();
  document.getElementById('auto-delete-days').value = settings.autoDeleteDays !== undefined ? settings.autoDeleteDays : 2;
  renderSyncSettings();
}

function renderLeaderPool() {
  const container = document.getElementById('leader-pool-list');
  const pool = settings.leaderPool || [];

  container.innerHTML = '';
  if (pool.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No hay líderes configurados. Agregá uno.</p>';
    return;
  }
  pool.forEach(name => {
    const member = (settings.teamMembers || []).find(m => m.name === name);
    const color = member?.color || getColorForName(name);
    const item = document.createElement('div');
    item.className = 'settings-leader-item';
    item.innerHTML = `
      <div class="leader-avatar-mini" style="background:${color}">${getInitials(name)}</div>
      <span>${escHtml(name)}</span>
      <button class="leader-delete-btn" data-name="${escAttr(name)}" title="Quitar del sorteo">
        <span class="material-icons-round">close</span>
      </button>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll('.leader-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      settings.leaderPool = (settings.leaderPool || []).filter(n => n !== name);
      try {
        await api('PUT', '/settings', { leaderPool: settings.leaderPool });
        renderLeaderPool();
        toast(`${name} quitado del sorteo`);
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    });
  });
}

document.getElementById('add-leader-btn').addEventListener('click', () => {
  const pool = settings.leaderPool || [];
  const allMembers = (settings.teamMembers || []).map(m => m.name);
  const available = allMembers.filter(n => !pool.includes(n));

  if (available.length === 0) {
    toast('Todos los miembros ya están en el sorteo', 'error');
    return;
  }

  // Show a simple select prompt
  openPromptModal('Agregar líder', 'Nombre', false, false, async ({ name }) => {
    if (!name) return;
    if (pool.includes(name)) {
      toast('Ya está en el sorteo', 'error');
      return;
    }
    settings.leaderPool = [...pool, name];
    try {
      await api('PUT', '/settings', { leaderPool: settings.leaderPool });
      renderLeaderPool();
      toast(`${name} agregado al sorteo`);
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
  });

  // Replace the text input with a dropdown of available members
  setTimeout(() => {
    const inputEl = document.getElementById('prompt-modal-input');
    const selectEl = document.createElement('select');
    selectEl.id = 'prompt-modal-input';
    selectEl.className = 'filter-select';
    selectEl.style.cssText = 'width:100%;padding:.65rem .85rem;font-size:.9rem';
    available.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      selectEl.appendChild(opt);
    });
    inputEl.replaceWith(selectEl);
  }, 50);
});

document.getElementById('save-auto-delete').addEventListener('click', async () => {
  const days = parseInt(document.getElementById('auto-delete-days').value) || 2;
  settings.autoDeleteDays = days;
  try {
    await api('PUT', '/settings', { autoDeleteDays: days });
    toast('Configuración guardada');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
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
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Parse DD/MM/YYYY to YYYY-MM-DD (ISO), returns '' if invalid
function parseDDMMYYYY(str) {
  if (!str) return '';
  const parts = str.split('/');
  if (parts.length !== 3) return '';
  const dd = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');
  const yyyy = parts[2];
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return '';
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (isNaN(d)) return '';
  return `${yyyy}-${mm}-${dd}`;
}

// Convert YYYY-MM-DD to DD/MM/YYYY for input display
function isoToDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
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
    status: 'Status', owner: 'Owner', comments: 'Comentario', taskNumber: '#'
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
  currentFilter = { priority: 'all', assignee: '', status: '', client: '', search: '' };
  document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
  document.querySelector('.chip[data-filter="all"]')?.classList.add('active');
  document.getElementById('filter-assignee').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-client').value = '';
  document.getElementById('search-input').value = '';

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

document.getElementById('search-overlay-input').addEventListener('input', (e) => {
  performOverlaySearch(e.target.value.trim());
});

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

// --- CSV IMPORT & GOOGLE SHEETS SYNC ---
let pendingImportTasks = [];

function parseCSV(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Parse header row (handle quoted fields)
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

  // Map common header names to task fields
  const fieldMap = {
    '#': 'taskNumber', 'numero': 'taskNumber', 'number': 'taskNumber',
    'cliente': 'client', 'client': 'client',
    'proyecto': 'project', 'project': 'project', 'tema': 'project', 'tema / proyecto': 'project',
    'asignado': 'assignee', 'assignee': 'assignee', 'assigned': 'assignee',
    'supervisor': 'supervisor',
    'prioridad': 'priority', 'priority': 'priority',
    'deadline': 'deadline', 'fecha': 'deadline', 'fecha limite': 'deadline',
    'status': 'status', 'estado': 'status',
    'owner': 'owner', 'dueño': 'owner',
    'comentarios': 'comments', 'comments': 'comments', 'notas': 'comments'
  };

  const colMapping = headers.map(h => fieldMap[h] || null);

  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const task = {
      client: '', project: '', assignee: '', supervisor: '',
      priority: 'TBD', deadline: '', status: 'sin empezar',
      owner: '', comments: '', isSupervision: false, taskNumber: ''
    };

    colMapping.forEach((field, idx) => {
      if (field && values[idx] !== undefined) {
        let val = values[idx].replace(/^"|"$/g, '');
        // Skip TIME OFF rows
        if (field === 'client' && val === 'TIME OFF') return;
        task[field] = val;
      }
    });

    // Only add if there's at least some content
    if (task.client || task.project || task.assignee) {
      parsed.push(task);
    }
  }

  return parsed;
}

function openImportModal(parsedTasks) {
  pendingImportTasks = parsedTasks;
  document.getElementById('import-preview').textContent =
    `Se encontraron ${parsedTasks.length} tareas para importar.`;

  const sampleFields = parsedTasks.length > 0
    ? Object.entries(parsedTasks[0]).filter(([,v]) => v).map(([k]) => k).join(', ')
    : '';
  document.getElementById('import-column-info').textContent =
    sampleFields ? `Campos detectados: ${sampleFields}` : '';

  document.getElementById('import-modal').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
  pendingImportTasks = [];
}

async function executeImport(mode) {
  if (pendingImportTasks.length === 0) return;
  closeImportModal();

  try {
    if (mode === 'replace') {
      // Delete all existing regular tasks first
      const existing = getRegularTasks();
      if (existing.length > 0) {
        toast(`Eliminando ${existing.length} tareas existentes...`, 'info');
        await Promise.all(existing.map(t => api('DELETE', `/tasks/${t.id}`)));
      }
    }

    toast(`Importando ${pendingImportTasks.length} tareas...`, 'info');
    // Create tasks in batches of 10 for speed
    for (let i = 0; i < pendingImportTasks.length; i += 10) {
      const batch = pendingImportTasks.slice(i, i + 10);
      await Promise.all(batch.map(t => api('POST', '/tasks', t)));
    }

    await softRefresh();
    toast(`${pendingImportTasks.length} tareas importadas correctamente`);
    pendingImportTasks = [];
  } catch (err) {
    toast('Error al importar: ' + err.message, 'error');
  }
}

// Import modal handlers
document.getElementById('import-modal-close').addEventListener('click', closeImportModal);
document.getElementById('import-cancel').addEventListener('click', closeImportModal);
document.getElementById('import-modal').querySelector('.modal-backdrop').addEventListener('click', closeImportModal);

document.getElementById('import-replace').addEventListener('click', () => executeImport('replace'));
document.getElementById('import-add').addEventListener('click', () => executeImport('add'));

// CSV file import
document.getElementById('import-csv-btn').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const csvText = evt.target.result;
    const parsed = parseCSV(csvText);
    if (parsed.length === 0) {
      toast('No se encontraron tareas en el archivo CSV', 'error');
      return;
    }
    openImportModal(parsed);
  };
  reader.readAsText(file);
  e.target.value = ''; // Reset so same file can be re-imported
});

// --- GOOGLE SHEETS AUTO-SYNC ---
let sheetSyncInterval = null;

function updateSyncIndicator(status) {
  const indicator = document.getElementById('sync-indicator');
  const dot = indicator.querySelector('.sync-indicator-dot');
  const icon = indicator.querySelector('.sync-indicator-icon');

  if (!settings.sheetSyncEnabled || !settings.sheetSyncUrl) {
    indicator.classList.add('hidden');
    return;
  }

  indicator.classList.remove('hidden');

  if (status === 'syncing') {
    icon.classList.add('spinning');
    dot.className = 'sync-indicator-dot syncing';
    indicator.title = 'Sincronizando...';
  } else if (status === 'ok') {
    icon.classList.remove('spinning');
    dot.className = 'sync-indicator-dot ok';
    const last = settings.sheetSyncLastResult;
    indicator.title = last ? `Sync OK - ${last.total} tareas (${timeAgo(last.timestamp)})` : 'Sync OK';
  } else if (status === 'error') {
    icon.classList.remove('spinning');
    dot.className = 'sync-indicator-dot error';
    indicator.title = 'Error de sincronización';
  } else {
    icon.classList.remove('spinning');
    dot.className = 'sync-indicator-dot';
    indicator.title = 'Auto-sync activado';
  }
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return 'hace unos segundos';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

function updateSyncStatusBox() {
  const box = document.getElementById('sync-status-box');
  const text = document.getElementById('sync-status-text');
  if (!box || !text) return;

  const last = settings.sheetSyncLastResult;
  if (!last) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  if (last.error) {
    text.textContent = `Error: ${last.error} (${timeAgo(last.timestamp)})`;
    box.style.background = 'rgba(239,68,68,.1)';
  } else {
    text.textContent = `Última sync: ${last.total} tareas (${last.created} nuevas, ${last.updated} actualizadas, ${last.deleted} eliminadas) — ${timeAgo(last.timestamp)}`;
    box.style.background = '';
  }
}

async function triggerSheetSync() {
  updateSyncIndicator('syncing');
  try {
    const result = await api('POST', '/sheet-sync', {});
    settings.sheetSyncLastRun = result.timestamp;
    settings.sheetSyncLastResult = result;
    updateSyncIndicator('ok');
    updateSyncStatusBox();

    // Refresh UI if there were changes
    if (result.created || result.updated || result.deleted) {
      await softRefresh();
      toast(`Sync: +${result.created} ~${result.updated} -${result.deleted}`, 'info');
    }
    return result;
  } catch (err) {
    updateSyncIndicator('error');
    settings.sheetSyncLastResult = { error: err.message, timestamp: new Date().toISOString() };
    updateSyncStatusBox();
    throw err;
  }
}

function startSheetSyncPolling() {
  stopSheetSyncPolling();
  if (!settings.sheetSyncEnabled || !settings.sheetSyncUrl) {
    updateSyncIndicator();
    return;
  }

  const intervalSec = settings.sheetSyncIntervalSec || 60;
  updateSyncIndicator(settings.sheetSyncLastResult?.error ? 'error' : 'ok');

  sheetSyncInterval = setInterval(async () => {
    if (document.visibilityState === 'hidden') return;
    try {
      await triggerSheetSync();
    } catch {}
  }, intervalSec * 1000);
}

function stopSheetSyncPolling() {
  if (sheetSyncInterval) {
    clearInterval(sheetSyncInterval);
    sheetSyncInterval = null;
  }
}

// Settings page: populate sync config when page loads
function renderSyncSettings() {
  const urlInput = document.getElementById('sheets-url');
  const enabledCheckbox = document.getElementById('sheet-sync-enabled');
  const intervalInput = document.getElementById('sheet-sync-interval');
  if (!urlInput) return;

  urlInput.value = settings.sheetSyncUrl || '';
  enabledCheckbox.checked = settings.sheetSyncEnabled || false;
  intervalInput.value = settings.sheetSyncIntervalSec || 60;
  updateSyncStatusBox();
}

// Save sync config
document.getElementById('save-sync-config').addEventListener('click', async () => {
  const url = document.getElementById('sheets-url').value.trim();
  const enabled = document.getElementById('sheet-sync-enabled').checked;
  const intervalSec = Math.max(15, parseInt(document.getElementById('sheet-sync-interval').value) || 60);

  if (enabled && !url) {
    toast('Ingresá la URL del Google Sheet', 'error');
    return;
  }
  if (enabled && !url.includes('docs.google.com/spreadsheets')) {
    toast('URL no válida. Debe ser un link de Google Sheets', 'error');
    return;
  }

  try {
    const result = await api('PUT', '/sheet-sync/config', { url, enabled, intervalSec });
    settings.sheetSyncUrl = result.sheetSyncUrl;
    settings.sheetSyncEnabled = result.sheetSyncEnabled;
    settings.sheetSyncIntervalSec = result.sheetSyncIntervalSec;
    toast(enabled ? 'Auto-sync activado' : 'Auto-sync desactivado');
    startSheetSyncPolling();

    // If just enabled, trigger an immediate sync
    if (enabled && url) {
      try { await triggerSheetSync(); } catch {}
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// Sync now button
document.getElementById('sync-now-btn').addEventListener('click', async () => {
  const url = document.getElementById('sheets-url').value.trim();
  if (!url) {
    toast('Ingresá la URL del Google Sheet', 'error');
    return;
  }
  if (!url.includes('docs.google.com/spreadsheets')) {
    toast('URL no válida', 'error');
    return;
  }

  // Save URL first if not saved yet
  if (url !== settings.sheetSyncUrl) {
    settings.sheetSyncUrl = url;
    await api('PUT', '/sheet-sync/config', { url });
  }

  const btn = document.getElementById('sync-now-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons-round spinning">sync</span> Sincronizando...';
  try {
    const result = await triggerSheetSync();
    toast(`Sync completado: ${result.total} tareas`);
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-round">sync</span> Sincronizar ahora';
  }
});

// --- COMPLETION CELEBRATION (confetti on EACH completed task) ---
function checkCelebration(task) {
  // Always launch confetti for individual task completion
  launchConfetti();

  // Row animation
  const row = document.querySelector(`tr[data-id="${task.id}"]`);
  if (row) {
    row.classList.add('row-completed');
    setTimeout(() => row.classList.remove('row-completed'), 1200);
  }

  // All tasks done for person -> extra toast
  if (task.assignee) {
    const personTasks = getRegularTasks().filter(t => t.assignee === task.assignee);
    const allDone = personTasks.every(t => t.status === 'completado');
    if (allDone && personTasks.length > 0) {
      setTimeout(() => toast(`${task.assignee} completó todas sus tareas!`), 500);
    }
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
  // Ctrl+K or Cmd+K -> search overlay
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

  // Ctrl+Z or Cmd+Z -> undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input, textarea, select, [contenteditable]')) {
    e.preventDefault();
    performUndo();
    return;
  }

  if (e.key === 'Escape') {
    if (!document.getElementById('search-overlay').classList.contains('hidden')) {
      closeSearchOverlay();
      return;
    }
    closeEditDropdown();
    closeInlineInput();
    closeModalDropdown();
    closePromptModal();
    closeTimeOffModal();
    closeNewTaskModal();
    closeCalEventModal();
    closeImportModal();
    document.getElementById('copy-modal').classList.add('hidden');
  }
});

// --- ACTIVITY LOG ---
let activityLog = [];

async function logActivity(action, taskId, field, oldValue, newValue, taskInfo) {
  try {
    await api('POST', '/activity-log', { action, taskId, field, oldValue, newValue, taskInfo });
  } catch {}
}

async function loadActivityLog() {
  const container = document.getElementById('activity-log-container');
  container.innerHTML = '<div class="activity-empty"><span class="material-icons-round">hourglass_empty</span><p>Cargando actividad...</p></div>';
  try {
    activityLog = await api('GET', '/activity-log');
    renderActivityLog();
  } catch (err) {
    container.innerHTML = '<div class="activity-empty"><span class="material-icons-round">error_outline</span><p>Error al cargar actividad</p></div>';
  }
}

function renderActivityLog() {
  const container = document.getElementById('activity-log-container');
  const filterAction = document.getElementById('activity-filter-action').value;
  const sortOrder = document.getElementById('activity-sort').value;

  let filtered = [...activityLog];
  if (filterAction) {
    filtered = filtered.filter(e => e.action === filterAction);
  }

  if (sortOrder === 'newest') {
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } else {
    filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="activity-empty"><span class="material-icons-round">history</span><p>No hay actividad registrada</p></div>';
    return;
  }

  const fieldNames = {
    client: 'Cliente', project: 'Proyecto', assignee: 'Asignado',
    supervisor: 'Supervisor', priority: 'Prioridad', deadline: 'Deadline',
    status: 'Status', owner: 'Owner', comments: 'Comentario', taskNumber: '#'
  };

  const actionLabels = { create: 'Tarea creada', update: 'Actualización', delete: 'Tarea eliminada' };
  const actionIcons = { create: 'add_circle', update: 'edit', delete: 'delete' };

  let html = '<div class="activity-log-list">';
  filtered.forEach(entry => {
    const actionClass = entry.action || 'update';
    const icon = actionIcons[actionClass] || 'edit';
    const actionLabel = actionLabels[actionClass] || 'Cambio';
    const fieldLabel = fieldNames[entry.field] || entry.field || '';
    const ts = new Date(entry.timestamp);
    const timeStr = ts.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    let valuesHtml = '';
    if (entry.action === 'update' && entry.field) {
      valuesHtml = `<div class="activity-log-values">
        ${entry.oldValue ? `<span class="activity-log-old">${escHtml(entry.oldValue)}</span>` : '<span class="activity-log-old">(vacío)</span>'}
        <span class="activity-log-arrow">\u2192</span>
        <span class="activity-log-new">${escHtml(entry.newValue || '(vacío)')}</span>
      </div>`;
    }

    // Only show revert for update actions that have a taskId and field
    const canRevert = entry.action === 'update' && entry.taskId && entry.field;
    const revertBtn = canRevert
      ? `<button class="btn btn-ghost btn-xs activity-revert-btn" data-entry-id="${entry.id}" data-task-id="${entry.taskId}" data-field="${escAttr(entry.field)}" data-old-value="${escAttr(entry.oldValue || '')}" data-task-info="${escAttr(entry.taskInfo || '')}" title="Revertir este cambio"><span class="material-icons-round" style="font-size:.95rem">undo</span></button>`
      : '';

    html += `<div class="activity-log-item">
      <div class="activity-log-icon action-${actionClass}">
        <span class="material-icons-round">${icon}</span>
      </div>
      <div class="activity-log-info">
        <div class="activity-log-title">${escHtml(actionLabel)}${fieldLabel ? ` - <strong>${escHtml(fieldLabel)}</strong>` : ''}</div>
        ${entry.taskInfo ? `<div class="activity-log-meta">${escHtml(entry.taskInfo)}</div>` : ''}
        ${valuesHtml}
        <div class="activity-log-meta"><span class="material-icons-round" style="font-size:.85rem">schedule</span>${timeStr}</div>
      </div>
      ${revertBtn}
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;

  // Bind revert button click handlers
  container.querySelectorAll('.activity-revert-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      const field = btn.dataset.field;
      const oldValue = btn.dataset.oldValue;
      const taskInfo = btn.dataset.taskInfo;

      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        toast('Tarea no encontrada - puede haber sido eliminada', 'error');
        return;
      }

      try {
        await api('PUT', `/tasks/${taskId}`, { [field]: oldValue });
        task[field] = oldValue;
        toast(`Revertido: ${taskInfo || 'cambio deshecho'}`);
        renderTasks();
        updateStats();
        renderActivityLog();
      } catch (err) {
        toast('Error al revertir: ' + err.message, 'error');
      }
    });
  });
}

// Activity log filter/sort handlers
document.getElementById('activity-filter-action')?.addEventListener('change', renderActivityLog);
document.getElementById('activity-sort')?.addEventListener('change', renderActivityLog);
document.getElementById('activity-refresh')?.addEventListener('click', loadActivityLog);

// --- INIT DATE PICKERS ON STATIC INPUTS ---
initDatePicker('#new-task-deadline');
initDatePicker('#timeoff-start');
initDatePicker('#timeoff-end');
initDatePicker('#cal-event-date');

// --- INIT ---
loadData();
