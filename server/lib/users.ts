// File-backed user store for demo purposes (no external DB).
// What: Read/write JSON with basic atomicity; verify login; track likes.
// Why: Keep persistence simple, transparent, and dependency-free.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');
const dataDir = path.join(projectRoot, 'data');
const usersPath = path.join(dataDir, 'users.json');

interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  likes: (number | string)[];
}

interface UsersDb { users: UserRecord[] }

// Ensure data directory and JSON file exist; create an empty DB if missing.
function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, JSON.stringify({ users: [] }, null, 2));
}

// Read users database from disk; tolerate malformed JSON by returning an empty DB.
export function readUsers(): UsersDb {
  ensureFile();
  const raw = fs.readFileSync(usersPath, 'utf8');
  try {
    return JSON.parse(raw) as UsersDb;
  } catch {
    return { users: [] };
  }
}

// Write database with a temp file + rename for basic atomicity on most filesystems.
export function writeUsers(db: UsersDb) {
  ensureFile();
  const tmp = usersPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, usersPath);
}

// Create a new user; stores SHA-256 hash of the password (demo only; use salted slow KDF in prod).
export function createUser({ email, name, password }: { email: string; name: string; password: string }) {
  const db = readUsers();
  if (db.users.find(u => u.email === email)) {
    throw new Error('Sähköpostilla on jo käyttäjä');
  }
  const id = crypto.randomUUID();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const user: UserRecord = { id, email, name, passwordHash, likes: [] };
  db.users.push(user);
  writeUsers(db);
  return { id, email, name };
}

// Lookup by id; returns a public view (no passwordHash).
export function getUserById(id: string) {
  const db = readUsers();
  const u = db.users.find(x => x.id === id);
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, likes: u.likes };
}

// Lookup by email; returns a public view (no passwordHash).
export function getUserByEmail(email: string) {
  const db = readUsers();
  const u = db.users.find(x => x.email === email);
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, likes: u.likes };
}

// Add a recipe to user's likes if not present (idempotent update).
export function addLike(userId: string, recipeId: number | string) {
  const db = readUsers();
  const u = db.users.find(x => x.id === userId);
  if (!u) throw new Error('Käyttäjää ei löytynyt');
  if (!u.likes.includes(recipeId)) {
    u.likes.push(recipeId);
    writeUsers(db);
  }
  return { ok: true };
}

// Verify credentials by comparing SHA-256(password) with stored hash.
// Note: Demo-grade only; prefer salted, slow hashes (bcrypt/argon2) in production.
export function verifyUser({ email, password }: { email: string; password: string }) {
  const db = readUsers();
  const u = db.users.find(x => x.email === email);
  if (!u) return null;
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  if (u.passwordHash !== passwordHash) return null;
  return { id: u.id, email: u.email, name: u.name };
}
