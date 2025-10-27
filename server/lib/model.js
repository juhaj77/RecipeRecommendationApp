// Heuristic recommender (default): token-overlap with light boosts from user likes.
// What: Normalize recipe tokens, compute overlap with selection, boost items sharing liked tokens.
// Why: Deterministic, fast, and memory-safe at this dataset size. Uses Set for O(1) checks.
import { loadAllRecipes } from './csv.js';
import { getUserById } from './users.js';

// Normalize raw ingredient text to a comparable token (lowercase, strip numbers/units/punctuation).
// Why: Reduces sparsity so similar strings match reliably.
function normalizeToken(input) {
  let s = String(input == null ? '' : input).toLowerCase();
  // remove vulgar fractions and numeric amounts
  s = s.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, ' ');
  s = s.replace(/\b\d+\s*\/\s*\d+\b/g, ' ');
  s = s.replace(/\d+([.,]\d+)?/g, ' ');
  // common units
  s = s.replace(/\b(?:x|kpl|pc|pcs|pkg|pkgs|package|packages|g|kg|mg|l|dl|ml|tl|rkl|prk|pkt|ps|cl|cup|cups|tbsp|tbsps|tsp|tsps|oz|ounce|ounces|lb|lbs)\b\.?/g, ' ');
  // punctuation
  s = s.replace(/[(){}\[\],\.:;\-*–—]/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

// Build a Set of normalized tokens for a recipe from ingredients and NER fields.
// Why: Set enables O(1) membership checks when scoring.
function tokensFromRecipe(r) {
  const set = new Set();
  const add = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      const t = normalizeToken(x);
      if (t) set.add(t);
    }
  };
  add(r.ingredients);
  add(r.ner);
  return set;
}

export async function recommend({ userId, selectedIngredients = [], limit = 10 }) {
  const recipes = loadAllRecipes();
  const lim = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 10));

  // Prepare selected tokens
  const sel = new Set(
    Array.from(new Set(selectedIngredients))
      .map(normalizeToken)
      .filter(Boolean)
  );

  // If nothing selected, just return top lim first items with neutral score
  if (sel.size === 0) {
    return recipes.slice(0, lim).map(r => ({ ...r, score: 0 }));
  }

  // Liked boosting
  const user = userId ? getUserById(userId) : null;
  // Gather signals from user's past likes: recipe ids and all tokens seen in those recipes.
  const likedIds = new Set(user?.likes || []);
  const likedTokens = new Set();
  if (likedIds.size) {
    for (const r of recipes) {
      if (likedIds.has(r.id)) {
        for (const t of tokensFromRecipe(r)) likedTokens.add(t);
      }
    }
  }

  // Score function: overlap with selected + small boost for tokens seen in likes
  const results = [];
  for (const r of recipes) {
    const toks = tokensFromRecipe(r);
    let overlap = 0;
    for (const t of sel) if (toks.has(t)) overlap++;
    if (overlap === 0) {
      // skip completely unrelated items to keep list relevant
      continue;
    }
    let boost = 0;
    if (likedTokens.size) {
      for (const t of toks) if (likedTokens.has(t)) boost += 0.05; // tiny per-token boost
      if (likedIds.has(r.id)) boost += 0.5; // strong boost for already liked
    }
    const score = overlap + boost;
    results.push({ r, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, lim).map(({ r, score }) => ({ ...r, score }));
}
