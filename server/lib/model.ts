// Learnable recommender (optional): tiny logistic regression over tokens from title words, ingredients, and NER.
// What: Build a vocab over title+ingredient words+NER tokens (no directions), vectorize recipes, train a 1x sigmoid unit on likes vs non-likes.
// Why: Sigmoid suits binary like/not-like and outputs [0,1] scores that blend with heuristics.
import * as tf from '@tensorflow/tfjs';
import { loadAllRecipes } from './csv.ts';
import { getUserById } from './users.ts';

// Tokenize title/ingredient text into simple word tokens (lowercased, letters-only-ish, len>=2)
function tokenizeTitle(text?: string): string[] {
  if (!text) return [];
  const t = String(text).toLowerCase();
  return t
    .replace(/[(){}\[\],\.:;*–—\-\+\/=<>"]|'|`/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

function tokenizeIngredient(s?: string): string[] {
  if (!s) return [];
  // Remove quantities/units crudely by stripping digits and common punctuations, then split
  return tokenizeTitle(
    String(s)
      .replace(/\d+([.,]\d+)?/g, ' ')
      .replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, ' ')
  );
}

function buildVocab(recipes: Array<{ title?: string; ner?: string[]; ingredients?: string[] }>) {
  const set = new Set<string>();
  for (const r of recipes) {
    // Include NER tokens as-is (already lowercase/normalized in CSV loader)
    r.ner?.forEach(i => set.add(String(i).toLowerCase()));
    // Include title tokens
    tokenizeTitle(r.title).forEach(tok => set.add(tok));
    // Include ingredient word tokens
    (r.ingredients || []).forEach((ing: any) => tokenizeIngredient(String(ing)).forEach(tok => set.add(tok)));
  }
  const vocab = Array.from(set);
  const index = new Map<string, number>(vocab.map((w, i) => [w, i] as const));
  return { vocab, index };
}

// Vectorize a recipe into a binary bag-of-words over the vocab index.
// Why: Simple, sparse-friendly representation; arrays are fast to iterate and sum.
function recipeToVector(r: any, index: Map<string, number>) {
  const v = new Array<number>(index.size).fill(0);
  const addToken = (tok: string) => { const idx = index.get(tok); if (idx !== undefined) v[idx] = 1; };
  const addArr = (arr?: string[]) => arr?.forEach(i => addToken(String(i).toLowerCase()));
  addArr(r.ner);
  tokenizeTitle(r.title).forEach(addToken);
  (r.ingredients || []).forEach((ing: any) => tokenizeIngredient(String(ing)).forEach(addToken));
  return v;
}

export async function recommend({ userId, selectedIngredients = [], limit = 10 }: { userId?: string; selectedIngredients?: string[]; limit?: number; }) {
  const recipes = loadAllRecipes();
  const { vocab, index } = buildVocab(recipes as any);

  const lim = Math.max(1, Math.min(50, Number.isFinite(limit as number) ? (limit as number) : 10));

  const user = userId ? getUserById(userId) : null;
  const likedSet = new Set(user?.likes || []);
  const liked = recipes.filter(r => likedSet.has(r.id));

  // Map selected query terms to vocab via substring (case-insensitive), not exact token only.
  const selectedVec = new Array<number>(index.size).fill(0);
  const qTerms = selectedIngredients.map(s => String(s || '').toLowerCase()).filter(Boolean);
  for (let j = 0; j < vocab.length; j++) {
    const tok = vocab[j];
    for (const q of qTerms) {
      if (!q) continue;
      if (tok.includes(q) || q.includes(tok)) { selectedVec[j] = 1; break; }
    }
  }

  // If we have too few positive examples, fall back to simple overlap to avoid overfitting.
  if (!liked || liked.length < 2) {
    const scored = recipes.map(r => {
      const rv = recipeToVector(r, index);
      let score = 0;
      for (let i = 0; i < rv.length; i++) score += rv[i] * selectedVec[i];
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, lim).map(({ r, score }) => ({ ...r, score }));
  }

  const X = tf.tensor2d(liked.map(r => recipeToVector(r, index)));
  const y = tf.tensor2d(new Array(liked.length).fill([1]));
  const nonLiked = recipes.filter(r => !likedSet.has(r.id)).slice(0, Math.min(200, recipes.length));
  const Xneg = tf.tensor2d(nonLiked.map(r => recipeToVector(r, index)));
  const yneg = tf.tensor2d(new Array(nonLiked.length).fill([0]));
  const Xall = X.concat(Xneg, 0);
  const yall = y.concat(yneg, 0);

  // Model: single sigmoid unit (logistic regression) over BoW features.
  // Why sigmoid: outputs [0,1] like-probability; pairs with binary cross-entropy; simple and stable.
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 1, inputShape: [index.size], activation: 'sigmoid', useBias: true }));
  model.compile({ optimizer: tf.train.adam(0.05), loss: 'binaryCrossentropy' });

  await model.fit(Xall, yall, { epochs: 10, verbose: 0, batchSize: 32 });

  // Predict like-probabilities for all recipes in one batch for efficiency.
  const allX = tf.tensor2d(recipes.map(r => recipeToVector(r, index)));
  const preds = model.predict(allX) as tf.Tensor | tf.Tensor[];
  // Extract numeric scores regardless of tfjs backend returning a single tensor or an array.
  const scores = Array.isArray(preds)
    ? (await (preds[0] as tf.Tensor).data())
    : await (preds as tf.Tensor).data();

  const results = recipes.map((r, i) => {
    const rv = recipeToVector(r, index);
    let overlap = 0;
    for (let j = 0; j < rv.length; j++) overlap += rv[j] * selectedVec[j];
    const score = 0.7 * Number(scores[i]) + 0.3 * (overlap / (qTerms.length || 1));
    return { r, score };
  });

  X.dispose();
  y.dispose();
  Xneg.dispose();
  yneg.dispose();
  Xall.dispose();
  yall.dispose();
  if (Array.isArray(preds)) preds.forEach(p => (p as tf.Tensor).dispose()); else (preds as tf.Tensor).dispose();
  allX.dispose();
  model.dispose();

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, lim).map(({ r, score }) => ({ ...r, score }));
}
