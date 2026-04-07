# IWAKY Panel Financiero 2026
## Servidor seguro con autenticación

---

## Despliegue automático (recomendado)

Necesitas un servidor VPS (Ubuntu 22+) con un dominio apuntando a su IP.

### 1. Apunta el dominio a tu servidor
En tu proveedor de DNS, crea un registro A:
```
panel.tudominio.com  →  IP_DE_TU_SERVIDOR
```

### 2. Sube el proyecto al servidor
```bash
# Desde tu ordenador
scp iwaky-panel.zip usuario@tu-servidor:~/
```

### 3. Ejecuta el instalador
```bash
# En el servidor
ssh usuario@tu-servidor
unzip iwaky-panel.zip
cd iwaky-panel
sudo bash deploy.sh
```

El script instala todo automáticamente:
- Node.js 20
- Nginx (proxy reverso)
- Let's Encrypt (SSL/HTTPS gratuito)
- PM2 (mantiene el servidor corriendo)

Al terminar tendrás: `https://panel.tudominio.com`

---

## Primer acceso

1. Abre `https://panel.tudominio.com`
2. Login: **admin** / **iwaky2026**
3. Ve a `https://panel.tudominio.com/admin`
4. **Cambia la contraseña del admin**
5. Crea usuarios para el equipo

### Roles disponibles
| Rol | Puede ver | Puede editar | Puede gestionar usuarios | Puede resetear |
|-----|-----------|--------------|--------------------------|----------------|
| **admin** | ✓ | ✓ | ✓ | ✓ |
| **editor** | ✓ | ✓ | ✗ | ✗ |
| **viewer** | ✓ | ✗ | ✗ | ✗ |

---

## Despliegue manual (alternativa)

```bash
# 1. Instalar Node.js 20+
# 2. Configurar
cd iwaky-panel
npm install
cp .env.example .env
nano .env  # Editar JWT_SECRET y DOMAIN

# 3. Arrancar
node server.js
# O con PM2:
pm2 start server.js --name iwaky-panel
```

---

## Seguridad incluida

- **JWT en cookie HttpOnly** — tokens no accesibles desde JavaScript
- **bcrypt** — contraseñas hasheadas con sal
- **Helmet.js** — headers de seguridad HTTP
- **Rate limiting** — máx. 10 intentos de login / 15 min
- **HTTPS** — cifrado SSL con Let's Encrypt
- **Sesiones con expiración** — 72h por defecto
- **Auditoría** — registro de quién cambió qué

---

## Estructura

```
iwaky-panel/
├── server.js        ← Servidor Express + Auth + API
├── package.json
├── .env.example     ← Plantilla de configuración
├── deploy.sh        ← Script de despliegue automático
├── nginx.conf       ← Config Nginx (referencia)
├── Dockerfile       ← Para despliegue con Docker
├── public/
│   ├── index.html   ← Panel financiero
│   ├── login.html   ← Página de login
│   └── admin.html   ← Gestión de usuarios
└── db/
    └── iwaky.db     ← SQLite (se crea automáticamente)
```

---

## Comandos útiles

```bash
# Ver logs en tiempo real
pm2 logs iwaky-panel

# Reiniciar
pm2 restart iwaky-panel

# Ver estado
pm2 status

# Backup de la base de datos
cp /opt/iwaky-panel/db/iwaky.db ~/backup_iwaky_$(date +%Y%m%d).db

# Renovar SSL (automático, pero por si acaso)
sudo certbot renew
```

---

## API REST

Todas las rutas (excepto login) requieren autenticación.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (devuelve cookie) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Info del usuario actual |
| GET | `/api/data` | Leer todos los datos |
| PUT | `/api/data` | Guardar datos (editor+) |
| GET | `/api/changelog` | Historial de cambios |
| POST | `/api/reset` | Reset (solo admin) |
| GET | `/api/users` | Listar usuarios (admin) |
| POST | `/api/users` | Crear usuario (admin) |
| PUT | `/api/users/:id` | Editar usuario (admin) |
