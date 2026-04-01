const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Helper to create a task object
function createTask({ client, taskNumber, project, assignee, supervisor, priority, deadline, status, owner, comments, isTimeOff, timeOffStart, timeOffEnd, timeOffType, timeOffTitle }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    client: client || "",
    taskNumber: taskNumber === undefined ? null : taskNumber,
    project: project || "",
    assignee: assignee || "",
    supervisor: supervisor || "",
    priority: priority || "",
    deadline: deadline || "",
    status: status || "",
    owner: owner || "",
    comments: comments || "",
    isSupervision: false,
    isTimeOff: isTimeOff || false,
    timeOffStart: timeOffStart || "",
    timeOffEnd: timeOffEnd || "",
    timeOffType: timeOffType || "",
    timeOffTitle: timeOffTitle || "",
    createdAt: now,
    updatedAt: now
  };
}

// ============================================================
// ALL 91 TASKS
// ============================================================

const tasks = [
  // ---- Assignee: Whalys (3 tasks) ----
  createTask({ client: "Red", taskNumber: 1, project: "Supervisión WC26", assignee: "Whalys", supervisor: "Whalys", priority: "alta", deadline: "2026-06-12", status: "on going", owner: "Agus" }),
  createTask({ client: "Alma Mora", taskNumber: 2, project: "Supervision flores", assignee: "Whalys", supervisor: "Whalys", priority: "alta", deadline: "2026-02-12", status: "en progreso", owner: "Jess" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Great Work - 15:30 a 18:30hs", assignee: "Whalys", supervisor: "Liso", priority: "alta", deadline: "2026-02-19", status: "on going", owner: "LuMos" }),

  // ---- Assignee: Nacho (4 tasks) ----
  createTask({ client: "DIAGEO", taskNumber: 1, project: "WC26 Responsible - stunt", assignee: "Nacho", supervisor: "Liso", priority: "media", deadline: "2026-02-25", status: "en progreso", owner: "Naki" }),
  createTask({ client: "LA COMU", taskNumber: 2, project: "Great Work - 15:30 a 18:30hs", assignee: "Nacho", supervisor: "Liso", priority: "alta", deadline: "2026-02-19", status: "on going", owner: "LuMos" }),
  createTask({ client: "ClubNutri", taskNumber: 3, project: "Supervision Campaña Leads", assignee: "Nacho", supervisor: "Nacho", priority: "media", deadline: "2026-02-18", status: "sin empezar", owner: "Del" }),
  createTask({ client: "PORSCHE", taskNumber: 4, project: "Supervision Caja azul (activaciones)", assignee: "Nacho", supervisor: "Zeke", priority: "baja", deadline: "2026-02-13", status: "sin empezar", owner: "Barbi" }),

  // ---- Assignee: Nia Freelo (2 tasks) ----
  createTask({ client: "ClubNutri", taskNumber: 1, project: "Campaña Leads", assignee: "Nia Freelo", supervisor: "Nacho", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Del" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Contrato hasta 27/2", assignee: "Nia Freelo", supervisor: "", priority: "", deadline: "2026-02-27", status: "en progreso", owner: "LuMos" }),

  // ---- Assignee: Tomi (3 tasks) ----
  createTask({ client: "Alma Mora", taskNumber: 1, project: "Día de los Enamorados", assignee: "Tomi", supervisor: "Whalys", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Jess" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Contrato hasta 13/2", assignee: "Tomi", supervisor: "Whalys", priority: "", deadline: "2026-02-13", status: "en progreso", owner: "LuMos" }),
  createTask({ client: "Red", taskNumber: null, project: "Busqueda nuevas bandas WC26", assignee: "Tomi", supervisor: "Whalys", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Juan" }),

  // ---- Assignee: Agus y Pau (4 tasks) ----
  createTask({ client: "DIAGEO", taskNumber: 1, project: "WC26 Responsible - stunt", assignee: "Agus y Pau", supervisor: "Liso", priority: "alta", deadline: "2026-02-25", status: "en progreso", owner: "Naki" }),
  createTask({ client: "Red", taskNumber: 2, project: "Storyboard contenido Edul - WC26", assignee: "Agus y Pau", supervisor: "Whalys", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Juan" }),
  createTask({ client: "TIME OFF", taskNumber: null, project: "Agus OOO (dia recuperado)", assignee: "Agus y Pau", supervisor: "Nacho", priority: "TBD", deadline: "2026-02-13", status: "sin empezar", owner: "LuMos", comments: "Recupera de haber estado este ultimo finde laburando", isTimeOff: true, timeOffStart: "2026-02-13", timeOffEnd: "2026-02-13", timeOffType: "OOO", timeOffTitle: "Agus OOO (dia recuperado)" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Great Work - 15:30 a 18:30hs", assignee: "Agus y Pau", supervisor: "Liso", priority: "alta", deadline: "2026-02-19", status: "on going", owner: "LuMos" }),

  // ---- Assignee: Chiari & Marti (5 tasks) ----
  createTask({ client: "Red", taskNumber: 1, project: "Nuevos Contenidos WC26", assignee: "Chiari & Marti", supervisor: "Whalys", priority: "baja", deadline: "2026-02-18", status: "en progreso", owner: "Juan" }),
  createTask({ client: "ClubNutri", taskNumber: 2, project: "Placas Gabriela Watson", assignee: "Chiari & Marti", supervisor: "Ruls", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Del" }),
  createTask({ client: "TIME OFF", taskNumber: null, project: "Marti PTO (20/2 - 6/3 -11 dias)", assignee: "Chiari & Marti", supervisor: "", priority: "", deadline: "2026-02-20", status: "sin empezar", owner: "LuMos", isTimeOff: true, timeOffStart: "2026-02-20", timeOffEnd: "2026-03-06", timeOffType: "Vacaciones", timeOffTitle: "Marti PTO (20/2 - 6/3 -11 dias)" }),
  createTask({ client: "Black", taskNumber: null, project: "Ajustes Lolla y OOH", assignee: "Chiari & Marti", supervisor: "Nacho", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Naki" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Great Work - 15:30 a 18:30hs", assignee: "Chiari & Marti", supervisor: "Liso", priority: "alta", deadline: "", status: "on going", owner: "LuMos" }),

  // ---- Assignee: Juli y Sofi (4 tasks) ----
  createTask({ client: "DIAGEO", taskNumber: 1, project: "Responsible Drinking", assignee: "Juli y Sofi", supervisor: "Nacho", priority: "alta", deadline: "2026-02-13", status: "sin empezar", owner: "Juan" }),
  createTask({ client: "El Esteco", taskNumber: 2, project: "Ajuste tradición KVs", assignee: "Juli y Sofi", supervisor: "", priority: "alta", deadline: "2026-02-13", status: "sin empezar", owner: "Luli" }),
  createTask({ client: "FLM", taskNumber: 3, project: "Piezas rrss vendimia", assignee: "Juli y Sofi", supervisor: "Whalys", priority: "", deadline: "2026-02-18", status: "sin empezar", owner: "Luli" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Great Work - 15:30 a 18:30hs", assignee: "Juli y Sofi", supervisor: "Liso", priority: "alta", deadline: "", status: "on going", owner: "LuMos" }),

  // ---- Assignee: Ruls (6 tasks) ----
  createTask({ client: "Red", taskNumber: 1, project: "Devolución Fotos IA WC26", assignee: "Ruls", supervisor: "Whalys", priority: "media", deadline: "2026-02-13", status: "en progreso", owner: "Juan" }),
  createTask({ client: "Alma Mora", taskNumber: 2, project: "Supervisión Flores", assignee: "Ruls", supervisor: "", priority: "alta", deadline: "2026-02-13", status: "on going", owner: "Jess" }),
  createTask({ client: "El Esteco", taskNumber: 3, project: "DD - Low alcohol KV", assignee: "Ruls", supervisor: "", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Luli" }),
  createTask({ client: "Dadá", taskNumber: 4, project: "Supervisión - KV Low alcohol red & white blend", assignee: "Ruls", supervisor: "", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Luli" }),
  createTask({ client: "ClubNutri", taskNumber: 5, project: "Revisar Libro ajuste", assignee: "Ruls", supervisor: "Ruls", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Del" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Retoques fotos x1", assignee: "Ruls", supervisor: "", priority: "media", deadline: "", status: "TBD", owner: "LuMos", comments: "quedan varias" }),

  // ---- Assignee: Meli (9 tasks) ----
  createTask({ client: "Dadá", taskNumber: 1, project: "KV - Low alcohol red & white blend", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Luli" }),
  createTask({ client: "ClubNutri", taskNumber: 2, project: "Caledario Marzo", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Del" }),
  createTask({ client: "Alma Mora", taskNumber: 4, project: "KV - Low Malbec", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Luli" }),
  createTask({ client: "Dadá", taskNumber: 5, project: "Tinto de verano placa (blanco + tinto)", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Luli" }),
  createTask({ client: "Black", taskNumber: null, project: "OOH SABRINA X LOLLA", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Naki" }),
  createTask({ client: "Dadá", taskNumber: null, project: "Caja Irlanda - ajustes", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "Dadá", taskNumber: null, project: "KV Vikingo - masterbrand", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "", status: "TBD", owner: "Luli" }),
  createTask({ client: "Red", taskNumber: null, project: "Armado Pieza Sorteo Bresh Chile", assignee: "Meli", supervisor: "Ruls", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Juan" }),
  createTask({ client: "Red", taskNumber: null, project: "Lolla AR", assignee: "Meli", supervisor: "", priority: "alta", deadline: "", status: "TBD", owner: "Juan" }),

  // ---- Assignee: Jota (7 tasks) ----
  createTask({ client: "Red", taskNumber: 1, project: "Armado Video Stand Movistar Arena", assignee: "Jota", supervisor: "", priority: "alta", deadline: "2026-02-13", status: "sin empezar", owner: "Juan" }),
  createTask({ client: "Red", taskNumber: 2, project: "Ajustes Teaser WC 26", assignee: "Jota", supervisor: "Whalys", priority: "alta", deadline: "2026-02-13", status: "sin empezar", owner: "Juan" }),
  createTask({ client: "Red", taskNumber: 3, project: "Ajuste video Viña del Mar", assignee: "Jota", supervisor: "", priority: "alta", deadline: "2026-02-13", status: "sin empezar", owner: "Juan" }),
  createTask({ client: "Dadá", taskNumber: 4, project: "Tinto de verano - blanco y ambos", assignee: "Jota", supervisor: "Whalys", priority: "alta", deadline: "2026-02-18", status: "en progreso", owner: "Luli" }),
  createTask({ client: "ClubNutri", taskNumber: 5, project: "Video Mariana Batista", assignee: "Jota", supervisor: "", priority: "alta", deadline: "2026-02-19", status: "sin empezar", owner: "Del" }),
  createTask({ client: "Black", taskNumber: null, project: "1 video lolla", assignee: "Jota", supervisor: "Nacho", priority: "alta", deadline: "", status: "TBD", owner: "Naki" }),
  createTask({ client: "DIAGEO", taskNumber: null, project: "Video moodboard Responsible drinking", assignee: "Jota", supervisor: "", priority: "alta", deadline: "", status: "esperando respuesta", owner: "" }),

  // ---- Assignee: Bua (6 tasks + 1 time-off) ----
  createTask({ client: "LA COMU", taskNumber: 1, project: "Great Work Zeke", assignee: "Bua", supervisor: "Zeke", priority: "alta", deadline: "2026-03-27", status: "en progreso", owner: "" }),
  createTask({ client: "Red", taskNumber: 1, project: "Campaña cultural Perú", assignee: "Bua", supervisor: "", priority: "alta", deadline: "2026-04-15", status: "sin empezar", owner: "Ari" }),
  createTask({ client: "Red", taskNumber: 2, project: "WC26 Stunt", assignee: "Bua", supervisor: "Whalys", priority: "alta", deadline: "2026-03-30", status: "en progreso", owner: "Juan" }),
  createTask({ client: "LA COMU", taskNumber: 3, project: "Credenciales agencia", assignee: "Bua", supervisor: "", priority: "alta", deadline: "2026-04-07", status: "en progreso", owner: "Sol" }),
  createTask({ client: "JW CORE", taskNumber: null, project: "Tendencias", assignee: "Bua", supervisor: "", priority: "media", deadline: "", status: "on going", owner: "" }),
  createTask({ client: "TIME OFF", taskNumber: null, project: "OOO 30/03 al 5/04", assignee: "Bua", supervisor: "", priority: "", deadline: "2026-03-30", status: "sin empezar", owner: "", isTimeOff: true, timeOffStart: "2026-03-30", timeOffEnd: "2026-04-05", timeOffType: "OOO", timeOffTitle: "OOO 30/03 al 5/04" }),

  // ---- Assignee: Jose (4 tasks) ----
  createTask({ client: "ClubNutri", taskNumber: 1, project: "Objetivos 2026", assignee: "Jose", supervisor: "Jose", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Jose" }),
  createTask({ client: "Alma Mora", taskNumber: 2, project: "Verificación IG", assignee: "Jose", supervisor: "", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Jose" }),
  createTask({ client: "LA COMU", taskNumber: 3, project: "Evalucaciones Equipo", assignee: "Jose", supervisor: "Jose", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Jose" }),
  createTask({ client: "DIAGEO", taskNumber: null, project: "Tendencias", assignee: "Jose", supervisor: "Jose", priority: "media", deadline: "2026-02-09", status: "on going", owner: "Agus" }),

  // ---- Assignee: Cesi (16 tasks) ----
  createTask({ client: "Alma Mora", taskNumber: 1, project: "Publicaciones Día de los enamorados", assignee: "Cesi", supervisor: "Jose", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Luli" }),
  createTask({ client: "Alma Mora", taskNumber: 2, project: "Repost Sofi Calvo Día de los enamorados", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "2026-02-13", status: "esperando respuesta", owner: "Jess", comments: "Fecha TBC" }),
  createTask({ client: "ClubNutri", taskNumber: 3, project: "Matriz resultados enero", assignee: "Cesi", supervisor: "Jose", priority: "baja", deadline: "2026-02-13", status: "sin empezar", owner: "Jose" }),
  createTask({ client: "ClubNutri", taskNumber: 4, project: "Stories Destacadas Expertos", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "2026-02-13", status: "sin empezar", owner: "Jose" }),
  createTask({ client: "ClubNutri", taskNumber: 5, project: "Calendario Abril", assignee: "Cesi", supervisor: "Nacho", priority: "baja", deadline: "2026-02-20", status: "sin empezar", owner: "Del" }),
  createTask({ client: "Dadá", taskNumber: 6, project: "Guía - Manual influencers", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "2026-02-23", status: "sin empezar", owner: "Luli" }),
  createTask({ client: "ClubNutri", taskNumber: null, project: "Calendario febrero fechas", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "esperando respuesta", owner: "Del" }),
  createTask({ client: "ClubNutri", taskNumber: null, project: "Plan medios Campaña Leads", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "esperando respuesta", owner: "Del" }),
  createTask({ client: "ClubNutri", taskNumber: null, project: "Calendario marzo", assignee: "Cesi", supervisor: "Jose", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Jose" }),
  createTask({ client: "ClubNutri", taskNumber: null, project: "Calendario TT + YT febrero", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "esperando respuesta", owner: "Jose" }),
  createTask({ client: "ClubNutri", taskNumber: null, project: "Scouting influs", assignee: "Cesi", supervisor: "Jose", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Jose" }),
  createTask({ client: "El Esteco", taskNumber: null, project: "Calendario marzo", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "FLM", taskNumber: null, project: "Calendario marzo", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "Bodegas", taskNumber: null, project: "Moderación", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "on going", owner: "Jose" }),
  createTask({ client: "ClubNutri", taskNumber: null, project: "Moderación", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "on going", owner: "Jose" }),
  createTask({ client: "LA COMU", taskNumber: null, project: "Búsqueda de tendencias/recursos/ideas", assignee: "Cesi", supervisor: "Jose", priority: "media", deadline: "", status: "on going", owner: "Jose" }),

  // ---- Assignee: Ubi (8 tasks) ----
  createTask({ client: "Red", taskNumber: 1, project: "Sorteo entradas Movistar Arena", assignee: "Ubi", supervisor: "Jose", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Juan", comments: "Ya tenemos un ganador. Esperando respuesta del segundo." }),
  createTask({ client: "JW CORE", taskNumber: 2, project: "Repost Contenidos Cosquín + propuesta de copy", assignee: "Ubi", supervisor: "Jose", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Juan", comments: "Hecho el cronograma de reposts y enviadas las propuestas de copy" }),
  createTask({ client: "JW**", taskNumber: 3, project: "Stickers Viña del Mar", assignee: "Ubi", supervisor: "Jose", priority: "alta", deadline: "2026-02-13", status: "en progreso", owner: "Juan", comments: "Ya quedaron subidos a Giphy y pendientes de aprobación." }),
  createTask({ client: "JW CORE", taskNumber: 4, project: "Tendencias Chile", assignee: "Ubi", supervisor: "Jose", priority: "media", deadline: "2026-02-18", status: "on going", owner: "Jose" }),
  createTask({ client: "JW**", taskNumber: 5, project: "Base de datos influs", assignee: "Ubi", supervisor: "Jose", priority: "media", deadline: "2026-02-18", status: "en progreso", owner: "Jose", comments: "Chequear influs y completar excel" }),
  createTask({ client: "Black", taskNumber: null, project: "Calendario LOLLA", assignee: "Ubi", supervisor: "Jose", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Naki", comments: "Esperando respuesta de cliente" }),
  createTask({ client: "JW CORE", taskNumber: null, project: "Moderación", assignee: "Ubi", supervisor: "Jose", priority: "media", deadline: "", status: "on going", owner: "Jose" }),
  createTask({ client: "JW CORE", taskNumber: null, project: "Ver streaming Chile", assignee: "Ubi", supervisor: "Jose", priority: "media", deadline: "", status: "on going", owner: "Jose" }),

  // ---- Assignee: "" (z_esperando respuesta - 10 tasks) ----
  createTask({ client: "Alma Mora", taskNumber: null, project: "Ageism \"eiyism\"", assignee: "", supervisor: "Liso", priority: "media", deadline: "2026-01-23", status: "esperando respuesta", owner: "Jess" }),
  createTask({ client: "Red", taskNumber: null, project: "Videos Cosquin Rock", assignee: "", supervisor: "Whalys", priority: "media", deadline: "2026-02-02", status: "esperando respuesta", owner: "Juan" }),
  createTask({ client: "Alma Mora", taskNumber: null, project: "Idea Flores", assignee: "", supervisor: "", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "Dadá", taskNumber: null, project: "Supervisión Videos- Tinto de verano", assignee: "", supervisor: "Liso", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Jess" }),
  createTask({ client: "Dadá", taskNumber: null, project: "Ajustes piezas masterbrand", assignee: "", supervisor: "", priority: "media", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "Dadá", taskNumber: null, project: "Diseño Irlanda Cajas x3", assignee: "", supervisor: "", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "El Esteco", taskNumber: null, project: "KV Blend de Extremos Pinot Noir", assignee: "", supervisor: "", priority: "media", deadline: "", status: "esperando respuesta", owner: "Luli" }),
  createTask({ client: "Red", taskNumber: null, project: "Ajustes Reel WC26", assignee: "", supervisor: "Whalys", priority: "", deadline: "", status: "esperando respuesta", owner: "Juan" }),
  createTask({ client: "Red", taskNumber: null, project: "Ajustes reels WC26", assignee: "", supervisor: "Whalys", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Juan" }),
  createTask({ client: "Red", taskNumber: null, project: "Edición Video UY WC26", assignee: "", supervisor: "Whalys", priority: "alta", deadline: "", status: "esperando respuesta", owner: "Juan" }),
];

// ============================================================
// SETTINGS
// ============================================================

const settings = {
  passwordHash: "$2a$10$mBqVhOMfSJNpYBd4QZuxy.jdxwKO2FBm3Q22KkV652Uw7rLieofzC",
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
    { name: "Ruls", color: "#ef4444", role: "Equipo" },
    { name: "Meli", color: "#d946ef", role: "Equipo" },
    { name: "Jota", color: "#f97316", role: "Equipo" },
    { name: "Bua", color: "#14b8a6", role: "Equipo" },
    { name: "Jose", color: "#0ea5e9", role: "Equipo" },
    { name: "Cesi", color: "#84cc16", role: "Equipo" },
    { name: "Ubi", color: "#e11d48", role: "Equipo" },
    { name: "Liso", color: "#06b6d4", role: "Supervisor" },
    { name: "Zeke", color: "#14b8a6", role: "Supervisor" },
    { name: "Agus", color: "#f97316", role: "Owner" },
    { name: "Jess", color: "#e11d48", role: "Owner" },
    { name: "LuMos", color: "#8b5cf6", role: "Owner" },
    { name: "Naki", color: "#84cc16", role: "Owner" },
    { name: "Barbi", color: "#d946ef", role: "Owner" },
    { name: "Del", color: "#0ea5e9", role: "Owner" },
    { name: "Juan", color: "#ef4444", role: "Owner" },
    { name: "Luli", color: "#ec4899", role: "Owner" },
    { name: "Sol", color: "#a855f7", role: "Owner" }
  ],
  clients: [
    { name: "Red", color: "#ef444418", textColor: "#ef4444" },
    { name: "Alma Mora", color: "#8b5cf618", textColor: "#8b5cf6" },
    { name: "LA COMU", color: "#3b82f618", textColor: "#3b82f6" },
    { name: "DIAGEO", color: "#f59e0b18", textColor: "#f59e0b" },
    { name: "Black", color: "#0f172a18", textColor: "#0f172a" },
    { name: "PORSCHE", color: "#0ea5e918", textColor: "#0ea5e9" },
    { name: "ClubNutri", color: "#10b98118", textColor: "#10b981" },
    { name: "TIME OFF", color: "#94a3b818", textColor: "#94a3b8" },
    { name: "Dadá", color: "#d946ef18", textColor: "#d946ef" },
    { name: "El Esteco", color: "#14b8a618", textColor: "#14b8a6" },
    { name: "FLM", color: "#f9731618", textColor: "#f97316" },
    { name: "JW CORE", color: "#ef444418", textColor: "#ef4444" },
    { name: "JW**", color: "#ec489918", textColor: "#ec4899" },
    { name: "Bodegas", color: "#6366f118", textColor: "#6366f1" }
  ],
  assigneeOrder: [
    "Whalys",
    "Nacho",
    "Nia Freelo",
    "Tomi",
    "Agus P.",
    "Pau",
    "Chiari",
    "Marti",
    "Juli",
    "Sofi",
    "Ruls",
    "Meli",
    "Jota",
    "Bua",
    "Jose",
    "Cesi",
    "Ubi"
  ],
  teamGroups: [
    { name: "Agus y Pau", color: "#3b82f6", members: ["Agus P.", "Pau"] },
    { name: "Chiari & Marti", color: "#a855f7", members: ["Chiari", "Marti"] },
    { name: "Juli y Sofi", color: "#06b6d4", members: ["Juli", "Sofi"] }
  ],
  supervisors: [],
  owners: []
};

// ============================================================
// WRITE FILES
// ============================================================

const dataDir = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const agendaPath = path.join(dataDir, 'agenda.json');
const settingsPath = path.join(dataDir, 'settings.json');

fs.writeFileSync(agendaPath, JSON.stringify({ tasks }, null, 2), 'utf8');
console.log(`Written ${tasks.length} tasks to ${agendaPath}`);

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
console.log(`Written settings to ${settingsPath}`);
console.log(`  - ${settings.teamMembers.length} team members`);
console.log(`  - ${settings.clients.length} clients`);
console.log(`  - ${settings.assigneeOrder.length} assignees in order`);
