const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// â•â•â• CONFIG â•â•â•
// Load .env manually (no extra dependency)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && !key.startsWith('#')) process.env[key.trim()] = vals.join('=').trim();
  });
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS) || 72;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DOMAIN = process.env.DOMAIN || '';

if (!process.env.JWT_SECRET) {
  console.warn('âš ï¸  No JWT_SECRET en .env â€” usando clave aleatoria (las sesiones se perderÃ¡n al reiniciar)');
  console.warn('   Crea un archivo .env con JWT_SECRET=tu-clave-secreta\n');
}

const app = express();

// â•â•â• SECURITY MIDDLEWARE â•â•â•
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    }
  }
}));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // max 10 login attempts per IP
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  standardHeaders: true,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 120, // 120 requests per minute
  standardHeaders: true,
});
app.use('/api/', apiLimiter);

// Trust proxy (for nginx/reverse proxy)
app.set('trust proxy', 1);

// â•â•â• DATABASE â•â•â•
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'iwaky.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('admin','editor','viewer')),
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS panel_data (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT 'sistema'
  );

  CREATE TABLE IF NOT EXISTS changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT DEFAULT 'sistema',
    changed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// â•â•â• DEFAULT DATA â•â•â•
const DEFAULT_DATA = {
  margins: { tienda: 0.23, mayorOnline: 0.07 },
  iva: [60000, 60000, 60000, 120000],
  revenue: {
    ventasValencia: Array(12).fill(242000),
    numVentas: Array(12).fill(340),
    accesorios: Array(12).fill(5000),
    reparaciones: Array(12).fill(0),
    b2b: Array(12).fill(200000),
    online: Array(12).fill(104054),
  },
  gastos: [
    { name: "Local Porta la Mar 70%", values: Array(12).fill(2275), cat: "local" },
    { name: "Electricidad 70%", values: Array(12).fill(210), cat: "local" },
    { name: "Seguros Local 70%", values: Array(12).fill(440), cat: "local" },
    { name: "Gastos Financieros Stock", values: Array(12).fill(2350), cat: "financiero" },
    { name: "Material Oficina", values: Array(12).fill(150), cat: "operativo" },
    { name: "Yoigo Internet", values: Array(12).fill(130), cat: "operativo" },
    { name: "Movistar", values: Array(12).fill(38), cat: "operativo" },
    { name: "Agua", values: Array(12).fill(60), cat: "local" },
    { name: "Securitas", values: Array(12).fill(95.91), cat: "local" },
    { name: "Wallapop Pro Cuentas", values: Array(12).fill(156), cat: "marketing" },
    { name: "Wallapop Destacados", values: Array(12).fill(800), cat: "marketing" },
    { name: "Adeslas 30%", values: Array(12).fill(42), cat: "personal" },
    { name: "Sanitas BBVA 30%", values: Array(12).fill(72.60), cat: "personal" },
    { name: "Holded", values: Array(12).fill(120), cat: "operativo" },
    { name: "Interparking VLC 70%", values: Array(12).fill(328.69), cat: "local" },
    { name: "Renting Paco 30%", values: Array(12).fill(210.60), cat: "operativo" },
    { name: "Cajas y Cargadores", values: Array(12).fill(1800), cat: "operativo" },
    { name: "GestorÃ­a 50%", values: Array(12).fill(230), cat: "operativo" },
    { name: "Alojamiento/Dominios", values: Array(12).fill(60), cat: "operativo" },
    { name: "Software Testeo 50%", values: Array(12).fill(600), cat: "operativo" },
    { name: "TPV Comisiones", values: Array(12).fill(500), cat: "financiero" },
    { name: "Gastos Extraordinarios", values: Array(12).fill(400), cat: "operativo" },
  ],
  nominas: {
    tiendaVLC: { name: "Tienda Valencia", employees: [
      { name: "Apostu, Giovani A. (75%)", monthly: Array(12).fill(3498.39) },
      { name: "GenovÃ©s Barea, Isabel (100%)", monthly: [2569.28,...Array(11).fill(2370.99)] },
      { name: "Meconi, Franco C. (100%)", monthly: [2279.33,...Array(11).fill(2667.63)] },
      { name: "Trillini MartÃ­n, Agustina (100%)", monthly: [2903.66,...Array(11).fill(2461.89)] },
      { name: "Dinga Dinga, Marcel (100%)", monthly: [1282.62,...Array(11).fill(1281.57)] },
      { name: "Pardo Puertas, Pedro D. (100%)", monthly: [1282.62,...Array(11).fill(1281.57)] },
    ]},
    direccion: { name: "DirecciÃ³n", employees: [
      { name: "TalavÃ¡n Ruiz, Jose F. (30%)", monthly: [4322.21,...Array(11).fill(4306.79)] },
      { name: "LledÃ³ Janonne, Carlos (30%)", monthly: [4404.84,...Array(11).fill(4426.08)] },
    ]},
    adminFinanzas: { name: "Admin / Finanzas", employees: [
      { name: "Avia AntÃºnez, Beatriz (60%)", monthly: [1976.66,1976.48,1977.48,1978.48,1979.48,1980.48,1981.48,1982.48,1983.48,1984.48,1985.48,1986.48] },
    ]},
    rrhh: { name: "RRHH & Operaciones", employees: [
      { name: "AugÃ© Francisco, Rodrigo (25%)", monthly: [3093.62,3045.95,3046.95,3047.95,3048.95,3049.95,3050.95,3051.95,3052.95,3053.95,3054.95,3055.95] },
    ]},
    sat: { name: "SAT / Servicio TÃ©cnico", employees: [
      { name: "GÃ³mez LeÃ³n, Yesid A. (40%)", monthly: [4103.24,...Array(11).fill(2767.12)] },
      { name: "JimÃ©nez Quizhpe, Lenin A. (40%)", monthly: [2443.47,...Array(11).fill(2136.48)] },
      { name: "Jiang, Weiwen (40%)", monthly: [3099.65,...Array(11).fill(2662.52)] },
    ]},
    almacen: { name: "AlmacÃ©n / Test", employees: [
      { name: "CaÃ±as BenÃ­tez, Vanesa (40%)", monthly: [2051.84,...Array(11).fill(2050.61)] },
      { name: "Ruiz Navas, Juan JosÃ© (60%)", monthly: [2070.29,...Array(11).fill(2069.05)] },
    ]},
  },
  historico: {
    aÃ±os: [2020,2021,2022,2023,2024,2025],
    lineas: {
      tiendaVLC: { name: "Ventas Tienda Valencia", mensual: Array.from({length:6},()=>Array(12).fill(0)), color: "#4f46e5" },
      b2b: { name: "Ventas B2B", mensual: Array.from({length:6},()=>Array(12).fill(0)), color: "#06b6d4" },
      online: { name: "Ventas Online", mensual: Array.from({length:6},()=>Array(12).fill(0)), color: "#8b5cf6" },
      accesorios: { name: "Accesorios", mensual: Array.from({length:6},()=>Array(12).fill(0)), color: "#f59e0b" },
      reparaciones: { name: "Reparaciones / SAT", mensual: Array.from({length:6},()=>Array(12).fill(0)), color: "#10b981" },
    },
    beneficioNeto: [0,0,0,0,0,0],
  },
  proyeccion2026: {
    tiendaVLC: Array(12).fill(0), b2b: Array(12).fill(0), online: Array(12).fill(0),
    accesorios: Array(12).fill(0), reparaciones: Array(12).fill(0),
    objetivo2026: { tiendaVLC:0, b2b:0, online:0, accesorios:0, reparaciones:0 },
  },
};

// Initialize data if empty
if (!db.prepare('SELECT 1 FROM panel_data WHERE id=1').get()) {
  db.prepare('INSERT INTO panel_data (id, data, updated_by) VALUES (1, ?, ?)').run(JSON.stringify(DEFAULT_DATA), 'sistema');
}

// Create default admin if no users exist
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const hash = bcrypt.hashSync('iwaky2026', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'Administrador', 'admin');
  console.log('\n  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”');
  console.log('  â”‚  USUARIO ADMIN CREADO:                      â”‚');
  console.log('  â”‚  Usuario: admin                              â”‚');
  console.log('  â”‚  ContraseÃ±a: iwaky2026                       â”‚');
  console.log('  â”‚  Â¡CAMBIA LA CONTRASEÃ‘A DESPUÃ‰S DE ENTRAR!   â”‚');
  console.log('  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜\n');
}

// â•â•â• AUTH MIDDLEWARE â•â•â•
function authenticate(req, res, next) {
  const token = req.cookies.iwaky_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, display_name, role, active FROM users WHERE id = ?').get(decoded.userId);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario desactivado' });
    req.user = user;
    next();
  } catch (e) {
    res.clearCookie('iwaky_token');
    return res.status(401).json({ error: 'SesiÃ³n expirada' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

function requireEditor(req, res, next) {
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'Sin permisos de ediciÃ³n' });
  next();
}

// â•â•â• AUTH ROUTES â•â•â•

// Login
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseÃ±a requeridos' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseÃ±a incorrectos' });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });

  // Update last login
  db.prepare('UPDATE users SET last_login = new Date().toISOString() WHERE id = ?').run(user.id);

  // Store session
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at) VALUES (?,?,?,?,?)')
    .run(user.id, tokenHash, req.ip, req.get('User-Agent')?.substring(0, 200), expiresAt);

  res.cookie('iwaky_token', token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_HOURS * 3600000,
    path: '/',
  });

  res.json({
    success: true,
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
  });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('iwaky_token', { path: '/' });
  res.json({ success: true });
});

// Check session
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Change password
app.post('/api/auth/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'MÃ­nimo 6 caracteres' });

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'ContraseÃ±a actual incorrecta' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true });
});

// â•â•â• USER MANAGEMENT (admin only) â•â•â•
app.get('/api/users', authenticate, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, active, created_at, last_login FROM users ORDER BY id').all();
  res.json(users);
});

app.post('/api/users', authenticate, requireAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password || !displayName) return res.status(400).json({ error: 'Datos incompletos' });
  if (password.length < 6) return res.status(400).json({ error: 'ContraseÃ±a mÃ­nimo 6 caracteres' });

  const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'El usuario ya existe' });

  const hash = bcrypt.hashSync(password, 10);
  const validRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'editor';
  const result = db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,?)')
    .run(username.trim().toLowerCase(), hash, displayName.trim(), validRole);

  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  const { displayName, role, active, password } = req.body;
  const userId = parseInt(req.params.id);

  if (displayName) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName.trim(), userId);
  if (role && ['admin','editor','viewer'].includes(role)) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, userId);
  if (password && password.length >= 6) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  }

  res.json({ success: true });
});

// â•â•â• PANEL DATA ROUTES (require auth) â•â•â•
app.get('/api/data', authenticate, (req, res) => {
  const row = db.prepare('SELECT data, updated_at, updated_by FROM panel_data WHERE id = 1').get();
  if (!row) return res.status(404).json({ error: 'No data' });
  res.json({ data: JSON.parse(row.data), updatedAt: row.updated_at, updatedBy: row.updated_by });
});

app.put('/api/data', authenticate, requireEditor, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });

  const userName = req.user.display_name;
  db.prepare('UPDATE panel_data SET data = ?, updated_at = new Date().toISOString(), updated_by = ? WHERE id = 1')
    .run(JSON.stringify(data), userName);
  db.prepare('INSERT INTO changelog (section, field, new_value, changed_by) VALUES (?,?,?,?)')
    .run('full_save', 'all', 'Datos actualizados', userName);

  res.json({ success: true, updatedAt: new Date().toISOString(), updatedBy: userName });
});

app.get('/api/changelog', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(db.prepare('SELECT * FROM changelog ORDER BY changed_at DESC LIMIT ?').all(limit));
});

app.post('/api/reset', authenticate, requireAdmin, (req, res) => {
  const userName = req.user.display_name;
  db.prepare('UPDATE panel_data SET data = ?, updated_at = new Date().toISOString(), updated_by = ? WHERE id = 1')
    .run(JSON.stringify(DEFAULT_DATA), userName);
  db.prepare('INSERT INTO changelog (section, field, new_value, changed_by) VALUES (?,?,?,?)')
    .run('reset', 'all', 'Reset completo', userName);
  res.json({ success: true });
});

app.get('/api/export', authenticate, (req, res) => {
  const row = db.prepare('SELECT data FROM panel_data WHERE id = 1').get();
  const D = JSON.parse(row.data);
  const M = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
  let csv = 'IWAKY Panel Financiero 2026\n\nINGRESOS,' + M.join(',') + ',TOTAL\n';
  for (const [n, k] of [['Tienda','ventasValencia'],['B2B','b2b'],['Online','online'],['Accesorios','accesorios'],['Reparaciones','reparaciones']]) {
    const v = D.revenue[k]; csv += `${n},${v.join(',')},${v.reduce((a,b)=>a+b,0)}\n`;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=iwaky_panel_2026.csv');
  res.send(csv);
});

// â•â•â• STATIC FILES & LOGIN PAGE â•â•â•
// Serve login page for unauthenticated users
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Protected panel â€” check cookie before serving
app.get('/', (req, res) => {
  const token = req.cookies.iwaky_token;
  if (!token) return res.redirect('/login');
  try {
    jwt.verify(token, JWT_SECRET);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (e) {
    res.clearCookie('iwaky_token');
    res.redirect('/login');
  }
});

// Admin panel
app.get('/admin', (req, res) => {
  const token = req.cookies.iwaky_token;
  if (!token) return res.redirect('/login');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(decoded.userId);
    if (!user || user.role !== 'admin') return res.status(403).send('Solo administradores');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } catch (e) {
    res.redirect('/login');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// â•â•â• START â•â•â•
app.listen(PORT, () => {
  console.log(`
  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
  â•‘   IWAKY Panel Financiero 2026 â€” Servidor Seguro     â•‘
  â•‘                                                      â•‘
  â•‘   Panel:    http://localhost:${PORT}                     â•‘
  â•‘   Admin:    http://localhost:${PORT}/admin                â•‘
  â•‘   Entorno:  ${NODE_ENV.padEnd(38)}   â•‘
  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  `);
});

