#!/bin/bash
# ═══════════════════════════════════════════════════════════
# IWAKY Panel Financiero — Script de Despliegue
# Ejecuta en tu servidor Ubuntu/Debian
# ═══════════════════════════════════════════════════════════

set -e

DOMAIN=""
EMAIL=""

echo ""
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   IWAKY Panel Financiero — Instalación           ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""

# Ask for domain
read -p "  Tu dominio (ej: panel.iwaky.com): " DOMAIN
read -p "  Tu email (para SSL Let's Encrypt): " EMAIL

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "  ✗ Dominio y email son obligatorios"
    exit 1
fi

echo ""
echo "  → Instalando dependencias del sistema..."

# Install Node.js 20
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install nginx
sudo apt-get update -y
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Install PM2
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

echo "  ✓ Dependencias instaladas"
echo ""
echo "  → Configurando la aplicación..."

# Setup app directory
APP_DIR="/opt/iwaky-panel"
sudo mkdir -p $APP_DIR
sudo cp -r ./* $APP_DIR/
sudo chown -R $USER:$USER $APP_DIR
cd $APP_DIR

# Install npm packages
npm install --production

# Create .env
JWT_SECRET=$(openssl rand -hex 32)
cat > .env << ENVEOF
PORT=3000
JWT_SECRET=$JWT_SECRET
SESSION_HOURS=72
DOMAIN=$DOMAIN
NODE_ENV=production
ENVEOF

echo "  ✓ Aplicación configurada"
echo ""
echo "  → Configurando Nginx..."

# Create nginx config
sudo tee /etc/nginx/sites-available/iwaky-panel > /dev/null << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXEOF

sudo ln -sf /etc/nginx/sites-available/iwaky-panel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

echo "  ✓ Nginx configurado"
echo ""
echo "  → Obteniendo certificado SSL (Let's Encrypt)..."

# Get SSL certificate
sudo certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive --redirect

echo "  ✓ SSL activado"
echo ""
echo "  → Arrancando la aplicación con PM2..."

# Start with PM2
cd $APP_DIR
pm2 stop iwaky-panel 2>/dev/null || true
pm2 start server.js --name iwaky-panel
pm2 save
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo ""
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   ✓ INSTALACIÓN COMPLETADA                      ║"
echo "  ║                                                  ║"
echo "  ║   Panel:  https://$DOMAIN             "
echo "  ║   Admin:  https://$DOMAIN/admin       "
echo "  ║                                                  ║"
echo "  ║   Usuario: admin                                 ║"
echo "  ║   Contraseña: iwaky2026                          ║"
echo "  ║   ¡CAMBIA LA CONTRASEÑA EN /admin!               ║"
echo "  ║                                                  ║"
echo "  ║   Comandos útiles:                               ║"
echo "  ║   pm2 logs iwaky-panel    (ver logs)             ║"
echo "  ║   pm2 restart iwaky-panel (reiniciar)            ║"
echo "  ║   pm2 monit               (monitorizar)         ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""
