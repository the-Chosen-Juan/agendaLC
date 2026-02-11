#!/bin/bash
echo ""
echo "  ========================================"
echo "    AGENDA LC - Iniciando..."
echo "  ========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js no esta instalado."
    echo ""
    echo "  Instalalo gratis:"
    echo "    Mac:   brew install node"
    echo "    Linux: sudo apt install nodejs npm"
    echo "    O descargalo de: https://nodejs.org"
    echo ""
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "  Instalando dependencias..."
    npm install
    echo ""
fi

# Seed data if needed
if [ ! -f "data/agenda.json" ]; then
    echo "  Cargando datos iniciales..."
    node seed.js
    echo ""
fi

echo "  ========================================"
echo "    Agenda LC esta corriendo!"
echo ""
echo "    Abri tu navegador en:"
echo "    http://localhost:3000"
echo ""
echo "    Contrasena: agenda2026"
echo ""
echo "    No cierres esta ventana."
echo "  ========================================"
echo ""

# Open browser automatically
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 &
elif command -v open &> /dev/null; then
    open http://localhost:3000 &
fi

# Start server
node server.js
