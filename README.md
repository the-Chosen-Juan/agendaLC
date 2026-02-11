# Agenda LC

Sitio web de gestión de tareas para el equipo. Reemplaza la planilla de Google Sheets.

**Contraseña por defecto:** `agenda2026` (se puede cambiar desde Configuración)

---

## Opción 1: Publicar online GRATIS (recomendado)

Esto le da al equipo una URL tipo `https://agenda-lc.onrender.com` que cualquiera puede abrir desde el navegador.

### Render.com (gratis)

1. Crear cuenta en [render.com](https://render.com) (se puede con cuenta de Google)
2. Click en **New** > **Web Service**
3. Conectar este repositorio de GitHub
4. Render detecta todo automáticamente. Solo verificar:
   - **Build Command:** `npm install && node seed.js`
   - **Start Command:** `node server.js`
5. Click en **Create Web Service**
6. En 2-3 minutos tienen la URL lista para compartir con el equipo

### Railway.app (gratis con $5 USD/mes de crédito)

1. Crear cuenta en [railway.app](https://railway.app) (se puede con cuenta de GitHub)
2. Click en **New Project** > **Deploy from GitHub repo**
3. Seleccionar este repositorio
4. Railway lo detecta y despliega automáticamente
5. Ir a **Settings** > **Networking** > **Generate Domain** para obtener la URL pública

---

## Opción 2: Usar en tu computadora

### Windows

1. Instalar Node.js desde [nodejs.org](https://nodejs.org) (elegir versión LTS, siguiente-siguiente-finalizar)
2. Hacer doble click en **`start.bat`**
3. Se abre el navegador automáticamente

### Mac / Linux

1. Instalar Node.js: `brew install node` (Mac) o `sudo apt install nodejs npm` (Linux)
2. Hacer doble click en **`start.sh`** (o desde terminal: `./start.sh`)
3. Se abre el navegador automáticamente

---

## Funcionalidades

- Login con contraseña compartida
- Tareas con cliente, proyecto, asignado, supervisor, prioridad, deadline, status, owner, comentarios
- Filtros por prioridad, asignado, status, cliente y búsqueda libre
- Vista agrupada por persona asignada
- Dashboard con estadísticas (total, en progreso, sin empezar, vencidas)
- Gestión de equipo (agregar/eliminar miembros)
- Gestión de clientes (agregar/eliminar)
- Cambio de contraseña
- Diseño responsive (funciona en celular y computadora)
