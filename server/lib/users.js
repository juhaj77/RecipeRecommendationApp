import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');
const dataDir = path.join(projectRoot, 'data');
const usersPath = path.join(dataDir, 'users.json');

function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, JSON.stringify({ users: [] }, null, 2));
}

export function readUsers() {
  ensureFile();
  const raw = fs.readFileSync(usersPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return { users: [] };
  }
}

export function writeUsers(db) {
  ensureFile();
  const tmp = usersPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, usersPath);
}

export function createUser({ email, name, password }) {
  const db = readUsers();
  if (db.users.find(u => u.email === email)) {
    throw new Error('Sähköpostilla on jo käyttäjä');
  }
  const id = crypto.randomUUID();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const user = { id, email, name, passwordHash, likes: [] };
  db.users.push(user);
  writeUsers(db);
  return { id, email, name };
}

export function getUserById(id) {
  const db = readUsers();
  const u = db.users.find(x => x.id === id);
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, likes: u.likes };
}

export function getUserByEmail(email) {
  const db = readUsers();
  const u = db.users.find(x => x.email === email);
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, likes: u.likes };
}

export function addLike(userId, recipeId) {
  const db = readUsers();
  const u = db.users.find(x => x.id === userId);
  if (!u) throw new Error('Käyttäjää ei löytynyt');
  if (!u.likes.includes(recipeId)) {
    u.likes.push(recipeId);
    writeUsers(db);
  }
  return { ok: true };
}

export function verifyUser({ email, password }) {
  const db = readUsers();
  const u = db.users.find(x => x.email === email);
  if (!u) return null;
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  if (u.passwordHash !== passwordHash) return null;
  return { id: u.id, email: u.email, name: u.name };
}
