// Server entrypoint: Express HTTP API for recipe suggestions.
// What: Boots middleware and defines endpoints used by the React client.
// Why: Keep a minimal surface (ingredients, recipes, like, user, login) and
//      perform light sanitization/normalization server-side for consistent results.
import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local libs (server-specific copies that don't rely on process.cwd)
import { allKnownIngredients, loadAllRecipes } from './lib/csv.ts';
import { recommend } from './lib/model.ts';
import { addLike, getUserById, verifyUser, createUser, readUsers } from './lib/users.ts';

import type { RecipesRequest, RecipesResponse, LikeRequest, IngredientsResponse } from '../types/index.d.ts';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Utility: stringify and optionally trim long strings for safer JSON responses.
// Why: Avoids accidentally returning excessively long text to the client UI.
function str(v: unknown, maxLen?: number) {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  if (!Number.isFinite(maxLen as number)) return s;
  return s.length > (maxLen as number) ? s.slice(0, maxLen) : s;
}

// Normalize ingredient text for searching: remove numbers, fractions, common unit words, and punctuation
// Why: Reduces token sparsity so different textual variants map to the same comparable token.
function normalizeIngredientToken(input: unknown): string {
  let s = String(input == null ? '' : input).toLowerCase();
  s = s.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, ' ');
  s = s.replace(/\b\d+\s*\/\s*\d+\b/g, ' ');
  s = s.replace(/\d+([.,]\d+)?/g, ' ');
  s = s.replace(/\b(?:x|kpl|pc|pcs|pkg|pkgs|package|packages|g|kg|mg|l|dl|ml|tl|rkl|prk|pkt|ps|cl|cup|cups|tbsp|tbsps|tsp|tsps|oz|ounce|ounces|lb|lbs)\b\.?/g, ' ');
  s = s.replace(/[(){}\[\],\.:;\-*–—]/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

// Tokenize free-form directions text into normalized tokens suitable for matching.
// Note: directions are no longer used for scoring, kept for cleaning/display only.
function tokenizeDirections(text?: unknown): string[] {
  if (text == null) return [];
  const t = String(text).toLowerCase();
  return t
    .replace(/[0-9]/g, ' ')
    .replace(/[(){}\[\],\.:;*–—\-\+\/=<>"]|'|`/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

// Tokenize title into simple word tokens (lowercased, letters-only, len>=2)
function tokenizeTitle(text?: unknown): string[] {
  if (text == null) return [];
  const t = String(text).toLowerCase();
  return t
    .replace(/[(){}\[\],\.:;*–—\-\+\/=<>"]|'|`/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

// Decode \uXXXX sequences into real unicode (e.g., \u00b0 → °) and tidy up bracketed/quoted arrays.
function cleanDirections(text: unknown, maxLen: number = 800): string {
  let s = str(text);
  if (!s) return '';
  // 1) Decode unicode escapes like \u00b0 → °
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  // 2) If it looks like a JSON array, parse and join nicely
  const t = s.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        s = arr.map(x => String(x)).join('\n');
      }
    } catch {
      // Fallback: strip outer brackets and quotes, split on commas
      const inner = t.replace(/^\[/, '').replace(/\]$/, '');
      s = inner
        .split(',')
        .map(part => part.replace(/^\s*"+|"+\s*$/g, '').trim())
        .filter(Boolean)
        .join('\n');
    }
  }
  // 3) Replace escaped newlines and tabs with spaces/newlines
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, ' ');
  // 4) Remove stray wrapping quotes/brackets if any still remain, but keep degree symbol intact
  s = s.replace(/[\[\]]/g, '').replace(/^"+|"+$/g, '');
  // 5) Collapse excessive whitespace
  s = s.replace(/\s{3,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // 6) Final trim to max length for UI
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// Normalize external link into an absolute URL so the browser doesn't treat it as a relative path on the dev host.
function normalizeLink(input?: unknown, maxLen: number = 160): string {
  let s = str(input, 300).trim();
  if (!s) return '';
  // Remove stray wrapping quotes
  s = s.replace(/^"+|"+$/g, '');
  // Already absolute
  if (/^https?:\/\//i.test(s)) return s.slice(0, maxLen);
  // Protocol-relative
  if (s.startsWith('//')) return ('https:' + s).slice(0, maxLen);
  // If it starts with a domain (e.g., cookbooks.com/...), prepend https://
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return ('https://' + s).slice(0, maxLen);
  // As a final fallback, if it starts with 'cookbooks.com' specifically
  if (s.toLowerCase().startsWith('cookbooks.com/')) return ('https://' + s).slice(0, maxLen);
  return s.slice(0, maxLen);
}

// Trim recipe fields for UI consumption; avoids overly long text and keeps payload compact.
function sanitizeRecipe(r: any, likesMap?: Map<string | number, number>) {
  const title = str(r?.title, 120);
  const rawLink = str(r?.link, 300);
  const link = normalizeLink(rawLink, 160);
  const site = str(r?.site, 100);
  const directions = cleanDirections(r?.directions, 800);
  const ingTotal = Array.isArray(r?.ingredients) ? r.ingredients.length : 0;
  const ing = Array.isArray(r?.ingredients)
    ? r.ingredients
        .slice(0, 8)
        .map((x: unknown) => str(String(x ?? ''), 60))
        .filter(Boolean)
    : [];
  const ingredientsTruncated = ingTotal > 8;
  const score = typeof r?.score === 'number' ? Number(r.score.toFixed(4)) : undefined;
  const likesCount = likesMap ? (likesMap.get(r?.id) || 0) : undefined;
  return { id: r?.id, title, ingredients: ing, ingredientsTruncated, link, site, score, directions, likesCount };
}

// Endpoint: suggest popular/known ingredient tokens for the UI autocomplete.
// Why: Pre-computed, deduped list keeps the client fast and reduces noisy variants.
app.get('/api/ingredients', (req: Request, res: Response<IngredientsResponse>) => {
  try {
    const ingredients = allKnownIngredients(300);
    res.json({ ingredients });
  } catch (e: any) {
    const fallback = [
      'chicken','beef','fish','tofu','minced meat','carrot','potatoes','pork','lamb','beans','milk','butter','sugar','eggs','flour','onion','tomatoes','cabbage','cheddar cheese',
      'green pepper','garlic','sour cream','cream cheese','salt','pepper','vanilla','bacon','rice','corn'
    ];
    res.json({ ingredients: fallback, error: e?.message || 'Virhe' });
  }
});

// Endpoint: compute recommendations for selected ingredients (and optional user history).
// What: Normalizes inputs, delegates to recommender, trims response; falls back to heuristic on errors.
// Why: Keep response predictable and safe while allowing multiple recommender implementations.
// Note: Matching is substring-based against recipe ingredients, NER, and title tokens (directions are ignored for scoring).
app.post('/api/recipes', async (req: Request<unknown, unknown, RecipesRequest>, res: Response<RecipesResponse>) => {
  // Safe-parse body
  const body = (req.body || {}) as RecipesRequest;
  try {
    const { userId, ingredients, limit } = body || {};
    const rawSelected = Array.isArray(ingredients) ? ingredients : [];
    // Keep original lowercased queries for substring matching; also produce normalized variants
    const qRaw = Array.from(new Set(rawSelected.map(x => String(x ?? '').toLowerCase().trim()).filter(Boolean)));
    const qIngredients = Array.from(new Set(rawSelected.map(normalizeIngredientToken).filter(Boolean)));

    const lim = Math.max(1, Math.min(50, Number.isFinite(limit as number) ? (limit as number) : 10));
    // Expand candidate pool before final substring filter to avoid empty results when strict filter removes many top-N
    const topK = Math.max(lim, Math.min(500, lim * 20));

    // Build likes count map from user store
    let likesMap = new Map<string | number, number>();
    try {
      const db: any = readUsers();
      if (db && Array.isArray(db.users)) {
        const m = new Map<string | number, number>();
        for (const u of db.users) {
          const arr = Array.isArray(u?.likes) ? u.likes : [];
          for (const rid of arr) m.set(rid, (m.get(rid) || 0) + 1);
        }
        likesMap = m;
      }
    } catch {}

    if (!qIngredients || qIngredients.length === 0) {
      const base = loadAllRecipes().slice(0, lim).map(r => ({ ...r, score: 0 }));
      const recipes = base.map(r => sanitizeRecipe(r, likesMap));
      return res.json({ recipes, note: 'Ei valittuja ainesosia; näytetään esimerkkejä' });
    }

    let out: any[] = [];
    try {
      // Use normalized tokens as inputs for the ML path; model maps queries to vocab with substring logic internally.
      // Request a widened candidate pool (topK) so the final strict substring filter still has enough items to choose from.
      out = await recommend({ userId, selectedIngredients: qIngredients, limit: topK });
    } catch (e) {
      // Heuristic fallback: substring score against title words, ingredient tokens, and NER tokens (equal weight per match)
      const recipes = loadAllRecipes();
      const qAll = Array.from(new Set([...qRaw, ...qIngredients]));
      const scored = recipes.map(r => {
        const nerToks = (r.ner || []).map(x => normalizeIngredientToken(x)).flatMap(s => s.split(' ')).filter(Boolean);
        const titleToks = tokenizeTitle(r.title);
        const ingToks = (r.ingredients || []).flatMap((ing: any) => normalizeIngredientToken(String(ing)).split(' ')).filter(Boolean);
        let score = 0;
        const incs = (tok: string) => qAll.some(q => tok.includes(q) || q.includes(tok));
        for (const x of nerToks) if (incs(x)) score += 1;
        for (const x of titleToks) if (incs(x)) score += 1;
        for (const x of ingToks) if (incs(x)) score += 1;
        return { ...r, score };
      });
      scored.sort((a, b) => (b.score as number) - (a.score as number));
      // Widen candidate pool on heuristic fallback as well
      out = scored.slice(0, topK) as any[];
    }

    // Final filter: a recipe must contain every query term in at least one of the following:
    // - ingredient strings or their normalized tokens
    // - NER strings or their normalized tokens
    // - title tokens
    // This aligns with README: substring-based match; directions are ignored for filtering/scoring.
    const containsAll = (r: any) => {
      // Ingredient haystack: raw strings + normalized tokens
      const ingStrs = (r.ingredients || []).map((ing: any) => String(ing).toLowerCase());
      const ingToks = (r.ingredients || [])
        .flatMap((ing: any) => normalizeIngredientToken(String(ing)).split(' '))
        .filter(Boolean);

      // NER haystack: raw strings + normalized tokens
      const nerStrs = (r.ner || []).map((x: any) => String(x).toLowerCase());
      const nerToks = (r.ner || [])
        .flatMap((x: any) => normalizeIngredientToken(String(x)).split(' '))
        .filter(Boolean);

      // Title haystack: tokens only (per design)
      const titleToks = tokenizeTitle(r.title);

      // Combined haystack, deduped
      const hay = Array.from(new Set<string>([...ingStrs, ...ingToks, ...nerStrs, ...nerToks, ...titleToks]));

      // Queries to enforce: use only the original raw query strings (lowercased, trimmed).
      // Rationale: avoid over-constraining multi-word queries by splitting them; honor true substring semantics.
      const qMust = Array.from(new Set<string>(qRaw));

      // Each query element must be a substring of at least one entry in the haystack
      for (const q of qMust) {
        const needle = String(q).toLowerCase();
        let ok = false;
        for (const h of hay) {
          // Use hay.includes(needle) to avoid false positives from very short hay tokens
          if (h.includes(needle)) { ok = true; break; }
        }
        if (!ok) return false;
      }

      return true;
    };

    const filtered = (out || []).filter(containsAll);
    const recipes = filtered.slice(0, lim).map(r => sanitizeRecipe(r, likesMap));

    return res.json({ recipes });
  } catch (e: any) {
    return res.json({ recipes: [], error: e.message || 'Virhe' });
  }
});

// Endpoint: record a user's like for a recipe (idempotent).
// Why: Likes feed future recommendations; stored server-side for persistence.
app.post('/api/like', (req: Request<unknown, unknown, LikeRequest>, res: Response) => {
  try {
    const { userId, recipeId } = (req.body || {}) as LikeRequest;
    if (!userId || !recipeId) return res.status(400).json({ error: 'userId ja recipeId vaaditaan' });
    const out = addLike(userId, recipeId);
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

// Endpoint: fetch a user profile by id.
// Why: Client needs name and likes to personalize recommendations.
app.get('/api/user', (req: Request, res: Response) => {
  try {
    const id = String((req.query as any).id || '').trim();
    if (!id) return res.status(400).json({ error: 'id vaaditaan' });
    const user = getUserById(id);
    if (!user) return res.status(404).json({ error: 'Käyttäjää ei löytynyt' });
    return res.json({ user });
  } catch (e: any) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

// Endpoint: simple email/password login against local JSON.
// Why: Demo-friendly auth without external services (not for production).
app.post('/api/login', (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body || {}) as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ error: 'email ja password vaaditaan' });
    const user = verifyUser({ email, password });
    if (!user) return res.status(401).json({ error: 'Virheellinen tunnus tai salasana' });
    return res.json({ user });
  } catch (e: any) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

// Endpoint: sign up (register new user)
// Body: { email, name, password }
app.post('/api/signup', (req: Request, res: Response) => {
  try {
    const { email, name, password } = (req.body || {}) as { email: string; name: string; password: string };
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name ja password vaaditaan' });
    const user = createUser({ email, name, password });
    return res.json({ user });
  } catch (e: any) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

// Health/info endpoint.
// Why: Quick check that the server is running and which endpoints exist.
app.get('/', (req: Request, res: Response) => {
  res
    .type('text')
    .send('RecipeSuggestion Express server running. Endpoints: /api/ingredients, /api/recipes, /api/like, /api/user, /api/login, /api/signup');
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
