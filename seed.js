const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data', 'agenda.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

// Hash the default password
const passwordHash = bcrypt.hashSync('agenda2026', 10);

// Settings with real password hash
const settings = {
  passwordHash,
  teamMembers: [
    { name: "Whalys", color: "#6366f1", role: "Equipo" },
    { name: "Nacho", color: "#f59e0b", role: "Equipo" },
    { name: "Nia Freelo", color: "#ec4899", role: "Freelance" },
    { name: "Tomi", color: "#10b981", role: "Equipo" },
    { name: "Agus P.", color: "#3b82f6", role: "Equipo", team: "Agus y Pau" },
    { name: "Pau", color: "#60a5fa", role: "Equipo", team: "Agus y Pau" },
    { name: "Chiari", color: "#a855f7", role: "Equipo", team: "Chiari & Marti" },
    { name: "Marti", color: "#c084fc", role: "Equipo", team: "Chiari & Marti" },
    { name: "Juli", color: "#06b6d4", role: "Equipo", team: "Juli y Sofi" },
    { name: "Sofi", color: "#22d3ee", role: "Equipo", team: "Juli y Sofi" },
    { name: "Liso", color: "#06b6d4", role: "Supervisor" },
    { name: "Zeke", color: "#14b8a6", role: "Supervisor" },
    { name: "Agus", color: "#f97316", role: "Owner" },
    { name: "Jess", color: "#e11d48", role: "Owner" },
    { name: "LuMos", color: "#8b5cf6", role: "Owner" },
    { name: "Naki", color: "#84cc16", role: "Owner" },
    { name: "Barbi", color: "#d946ef", role: "Owner" },
    { name: "Del", color: "#0ea5e9", role: "Owner" },
    { name: "Juan", color: "#ef4444", role: "Owner" },
    { name: "Luli", color: "#ec4899", role: "Owner" }
  ],
  clients: [
    { name: "Red", color: "#ef444418", textColor: "#ef4444" },
    { name: "Alma Mora", color: "#8b5cf618", textColor: "#8b5cf6" },
    { name: "LA COMU", color: "#3b82f618", textColor: "#3b82f6" },
    { name: "DIAGEO", color: "#f59e0b18", textColor: "#f59e0b" },
    { name: "Black", color: "#0f172a20", textColor: "#0f172a" },
    { name: "PORSCHE", color: "#0ea5e918", textColor: "#0ea5e9" },
    { name: "ClubNutri", color: "#10b98118", textColor: "#10b981" },
    { name: "TIME OFF", color: "#94a3b818", textColor: "#94a3b8" },
    { name: "Dadá", color: "#d946ef18", textColor: "#d946ef" }
  ],
  teamGroups: [
    { name: "Agus y Pau", color: "#3b82f6", members: ["Agus P.", "Pau"] },
    { name: "Chiari & Marti", color: "#a855f7", members: ["Chiari", "Marti"] },
    { name: "Juli y Sofi", color: "#06b6d4", members: ["Juli", "Sofi"] }
  ],
  supervisors: [],
  owners: []
};

// Tasks from the spreadsheet
const tasks = [
  // Asignado ap: 1 | Whalys
  { id: crypto.randomUUID(), client: "Red", taskNumber: 1, project: "Supervisión WC26", assignee: "Whalys", supervisor: "Whalys", priority: "alta", deadline: "2026-06-11", status: "on going", owner: "Agus", comments: "" },
  { id: crypto.randomUUID(), client: "Alma Mora", taskNumber: 2, project: "Supervision flores", assignee: "Whalys", supervisor: "Whalys", priority: "alta", deadline: "2026-02-11", status: "en progreso", owner: "Jess", comments: "" },
  { id: crypto.randomUUID(), client: "LA COMU", taskNumber: null, project: "Great Work - 15:30 a 18:30hs", assignee: "Whalys", supervisor: "Liso", priority: "alta", deadline: "2026-02-19", status: "on going", owner: "LuMos", comments: "" },

  // Asignado ap: 2 | Nacho
  { id: crypto.randomUUID(), client: "Alma Mora", taskNumber: 1, project: "Ageism (guiones nuevos + bajada)", assignee: "Nacho", supervisor: "Liso", priority: "alta", deadline: "2026-02-11", status: "en progreso", owner: "Jess", comments: "" },
  { id: crypto.randomUUID(), client: "DIAGEO", taskNumber: 2, project: "WC26 Responsible - stunt", assignee: "Nacho", supervisor: "Liso", priority: "media", deadline: "2026-02-11", status: "en progreso", owner: "Naki", comments: "" },
  { id: crypto.randomUUID(), client: "Black", taskNumber: 3, project: "Supervision ajustes Lolla", assignee: "Nacho", supervisor: "Liso", priority: "baja", deadline: "2026-02-11", status: "en progreso", owner: "Naki", comments: "" },
  { id: crypto.randomUUID(), client: "PORSCHE", taskNumber: 4, project: "Caja azul (activaciones)", assignee: "Nacho", supervisor: "Zeke", priority: "baja", deadline: "2026-02-13", status: "sin empezar", owner: "Barbi", comments: "" },

  // Asignado ap: 5 | Nia Freelo
  { id: crypto.randomUUID(), client: "ClubNutri", taskNumber: 1, project: "Calendario Marzo", assignee: "Nia Freelo", supervisor: "Nacho", priority: "alta", deadline: "2026-02-11", status: "en progreso", owner: "Del", comments: "" },
  { id: crypto.randomUUID(), client: "ClubNutri", taskNumber: 2, project: "Campaña Leads", assignee: "Nia Freelo", supervisor: "Nacho", priority: "media", deadline: "2026-02-12", status: "sin empezar", owner: "Del", comments: "" },
  { id: crypto.randomUUID(), client: "ClubNutri", taskNumber: 3, project: "Calendario Abril", assignee: "Nia Freelo", supervisor: "Nacho", priority: "baja", deadline: "2026-02-20", status: "sin empezar", owner: "Del", comments: "" },
  { id: crypto.randomUUID(), client: "LA COMU", taskNumber: null, project: "Contrato hasta 27/2", assignee: "Nia Freelo", supervisor: "", priority: "", deadline: "2026-02-27", status: "en progreso", owner: "LuMos", comments: "" },

  // Asignado ap: 5 | Tomi
  { id: crypto.randomUUID(), client: "Alma Mora", taskNumber: 1, project: "Dia de los Enamorados", assignee: "Tomi", supervisor: "Whalys", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Jess", comments: "" },
  { id: crypto.randomUUID(), client: "LA COMU", taskNumber: null, project: "Contrato hasta 13/2", assignee: "Tomi", supervisor: "", priority: "", deadline: "2026-02-13", status: "en progreso", owner: "LuMos", comments: "" },
  { id: crypto.randomUUID(), client: "Red", taskNumber: null, project: "Busqueda nuevas bandas WC26", assignee: "Tomi", supervisor: "Whalys", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Juan", comments: "" },

  // Asignado ap: 6 | Agus y Pau
  { id: crypto.randomUUID(), client: "Red", taskNumber: 1, project: "Storyboard contenido Edul - WC26", assignee: "Agus y Pau", supervisor: "Whalys", priority: "alta", deadline: "2026-02-11", status: "en progreso", owner: "Juan", comments: "" },
  { id: crypto.randomUUID(), client: "DIAGEO", taskNumber: 2, project: "WC26 Responsible - stunt", assignee: "Agus y Pau", supervisor: "Liso", priority: "alta", deadline: "2026-02-11", status: "en progreso", owner: "Naki", comments: "" },
  { id: crypto.randomUUID(), client: "LA COMU", taskNumber: null, project: "Vacaciones Pau 2/2 al 10/2", assignee: "Agus y Pau", supervisor: "Nacho", priority: "", deadline: "2026-02-02", status: "en progreso", owner: "", comments: "SOLO PAU" },
  { id: crypto.randomUUID(), client: "TIME OFF", taskNumber: null, project: "Agus OOO (dia recuperado)", assignee: "Agus y Pau", supervisor: "Nacho", priority: "TBD", deadline: "2026-02-13", status: "sin empezar", owner: "LuMos", comments: "Recupera de haber estado este ultimo finde laburando" },
  { id: crypto.randomUUID(), client: "LA COMU", taskNumber: null, project: "Great Work - 15:30 a 18:30hs", assignee: "Agus y Pau", supervisor: "Liso", priority: "alta", deadline: "2026-02-19", status: "on going", owner: "LuMos", comments: "" },

  // Asignado ap: 7 | Chiari & Marti
  { id: crypto.randomUUID(), client: "Black", taskNumber: 1, project: "Ajustes Lolla y OOH", assignee: "Chiari & Marti", supervisor: "Nacho", priority: "alta", deadline: "2026-02-11", status: "sin empezar", owner: "Naki", comments: "" },
  { id: crypto.randomUUID(), client: "Dadá", taskNumber: 2, project: "KV Wordings - Low alcohol red & white blend", assignee: "Chiari & Marti", supervisor: "Nacho", priority: "media", deadline: "2026-02-12", status: "sin empezar", owner: "Luli", comments: "" },
  { id: crypto.randomUUID(), client: "Red", taskNumber: 3, project: "Nuevos Contenidos WC26", assignee: "Chiari & Marti", supervisor: "Nacho", priority: "baja", deadline: "2026-02-13", status: "sin empezar", owner: "Juan", comments: "" },
  { id: crypto.randomUUID(), client: "LA COMU", taskNumber: 4, project: "Great Work - 15:30 a 18:30hs", assignee: "Chiari & Marti", supervisor: "Liso", priority: "alta", deadline: "", status: "on going", owner: "LuMos", comments: "" },
  { id: crypto.randomUUID(), client: "TIME OFF", taskNumber: null, project: "Marti PTO (20/2 - 6/3 -11 días)", assignee: "Chiari & Marti", supervisor: "", priority: "", deadline: "2026-02-20", status: "sin empezar", owner: "LuMos", comments: "" }
];

// Add timestamps
const now = new Date().toISOString();
tasks.forEach(t => {
  t.createdAt = now;
  t.updatedAt = now;
});

// Write files
fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks }, null, 2));

console.log(`Seeded ${tasks.length} tasks, ${settings.teamMembers.length} team members, ${settings.clients.length} clients`);
console.log('Default password: agenda2026');
