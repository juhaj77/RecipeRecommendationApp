import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local libs (server-specific copies that don't rely on process.cwd)
import { allKnownIngredients, loadAllRecipes } from './lib/csv.js';
import { recommend } from './lib/model.js';
import { addLike, getUserById, verifyUser } from './lib/users.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function str(v, maxLen) {
  if (typeof v !== 'string') v = v == null ? '' : String(v);
  if (!Number.isFinite(maxLen)) return v;
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

// Normalize ingredient text for searching: remove numbers, fractions, common unit words, and punctuation
function normalizeIngredientToken(input) {
  let s = String(input == null ? '' : input).toLowerCase();
  s = s.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, ' ');
  s = s.replace(/\b\d+\s*\/\s*\d+\b/g, ' ');
  s = s.replace(/\d+([.,]\d+)?/g, ' ');
  s = s.replace(/\b(?:x|kpl|pc|pcs|pkg|pkgs|package|packages|g|kg|mg|l|dl|ml|tl|rkl|prk|pkt|ps|cl|cup|cups|tbsp|tbsps|tsp|tsps|oz|ounce|ounces|lb|lbs)\b\.?/g, ' ');
  s = s.replace(/[(){}\[\],\.:;\-*–—]/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

function sanitizeRecipe(r) {
  const title = str(r?.title, 120);
  const link = str(r?.link, 160);
  const site = str(r?.site, 100);
  const ing = Array.isArray(r?.ingredients)
    ? r.ingredients
        .slice(0, 8)
        .map(x => str(String(x ?? ''), 60))
        .filter(Boolean)
    : [];
  const score = typeof r?.score === 'number' ? Number(r.score.toFixed(4)) : undefined;
  return { id: r?.id, title, ingredients: ing, link, site, score };
}

app.get('/api/ingredients', (req, res) => {
  try {
    const ingredients = allKnownIngredients(300);
    res.json({ ingredients });
  } catch (e) {
    const fallback = [
      'chicken','ground beef','milk','butter','sugar','eggs','flour','onion','tomatoes','cheddar cheese',
      'green pepper','garlic','sour cream','cream cheese','salt','pepper','vanilla','bacon','rice','corn'
    ];
    res.json({ ingredients: fallback, error: e.message || 'Virhe' });
  }
});

app.post('/api/recipes', async (req, res) => {
  // Safe-parse body
  const body = req.body || {};
  try {
    const { userId, ingredients, limit } = body || {};
    const rawSelected = Array.isArray(ingredients) ? ingredients : [];
    const qIngredients = Array.from(new Set(rawSelected.map(normalizeIngredientToken).filter(Boolean)));

    const lim = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 10));

    if (!qIngredients || qIngredients.length === 0) {
      const base = loadAllRecipes().slice(0, lim).map(r => ({ ...r, score: 0 }));
      const recipes = base.map(sanitizeRecipe);
      return res.json({ recipes, note: 'Ei valittuja ainesosia; näytetään esimerkkejä' });
    }

    let out = [];
    try {
      out = await recommend({ userId, selectedIngredients: qIngredients, limit: lim });
    } catch (e) {
      const recipes = loadAllRecipes();
      const sel = new Set(qIngredients);
      const scored = recipes.map(r => {
        const arr = (r.ner || []).map(x => normalizeIngredientToken(x)).filter(Boolean);
        let score = 0;
        for (const x of arr) if (sel.has(x)) score++;
        return { ...r, score };
      });
      scored.sort((a, b) => b.score - a.score);
      out = scored.slice(0, lim);
    }

    const sel = new Set(qIngredients);
    const containsAll = (r) => {
      if (!sel.size) return true;
      const set = new Set((r.ner || []).map(x => normalizeIngredientToken(x)).filter(Boolean));
      for (const s of sel) if (!set.has(s)) return false;
      return true;
    };

    const filtered = (out || []).filter(containsAll);
    const recipes = filtered.slice(0, lim).map(sanitizeRecipe);

    return res.json({ recipes });
  } catch (e) {
    return res.json({ recipes: [], error: e.message || 'Virhe' });
  }
});

app.post('/api/like', (req, res) => {
  try {
    const { userId, recipeId } = req.body || {};
    if (!userId || !recipeId) return res.status(400).json({ error: 'userId ja recipeId vaaditaan' });
    const out = addLike(userId, recipeId);
    return res.json(out);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

app.get('/api/user', (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id vaaditaan' });
    const user = getUserById(id);
    if (!user) return res.status(404).json({ error: 'Käyttäjää ei löytynyt' });
    return res.json({ user });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email ja password vaaditaan' });
    const user = verifyUser({ email, password });
    if (!user) return res.status(401).json({ error: 'Virheellinen tunnus tai salasana' });
    return res.json({ user });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Virhe' });
  }
});

app.get('/', (req, res) => {
  res.type('text').send('RecipeSuggestion Express server running. Endpoints: /api/ingredients, /api/recipes, /api/like, /api/user, /api/login');
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
