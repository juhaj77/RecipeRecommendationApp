// Learnable recommender (optional): tiny logistic regression over tokens from title words and NER.
// What: Build a vocab over title+NER tokens (no directions), vectorize recipes, train a 1x sigmoid unit on likes vs non-likes.
// Why: Sigmoid suits binary like/not-like and outputs [0,1] scores that blend with heuristics.
import * as tf from '@tensorflow/tfjs';
import { loadAllRecipes } from './csv.ts';
import { getUserById } from './users.ts';

// Tokenize title into simple word tokens (lowercased, letters-only, len>=2)
function tokenizeTitle(text?: string): string[] {
  if (!text) return [];
  const t = String(text).toLowerCase();
  return t
    .replace(/[(){}\[\],.:;*–—\-\+\/=<>"'`]/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

function buildVocab(recipes: Array<{ title?: string; ner?: string[] }>) {
  const set = new Set<string>();
  for (const r of recipes) {
    r.ner?.forEach(i => set.add(i));
    tokenizeTitle(r.title).forEach(tok => set.add(tok));
  }
  const vocab = Array.from(set);
  const index = new Map<string, number>(vocab.map((w, i) => [w, i] as const));
  return { vocab, index };
}

// Vectorize a recipe into a binary bag-of-words over the vocab index.
// Why: Simple, sparse-friendly representation; arrays are fast to iterate and sum.
function recipeToVector(r: any, index: Map<string, number>) {
  const v = new Array<number>(index.size).fill(0);
  const add = (arr?: string[]) => arr?.forEach(i => { const idx = index.get(i); if (idx !== undefined) v[idx] = 1; });
  add(r.ner);
  tokenizeTitle(r.title).forEach(tok => { const idx = index.get(tok); if (idx !== undefined) v[idx] = 1; });
  return v;
}

export async function recommend({ userId, selectedIngredients = [], limit = 10 }: { userId?: string; selectedIngredients?: string[]; limit?: number; }) {
  const recipes = loadAllRecipes();
  const { index } = buildVocab(recipes as any);

  const lim = Math.max(1, Math.min(50, Number.isFinite(limit as number) ? (limit as number) : 10));

  const user = userId ? getUserById(userId) : null;
  const likedSet = new Set(user?.likes || []);
  const liked = recipes.filter(r => likedSet.has(r.id));

  const selectedVec = new Array<number>(index.size).fill(0);
  selectedIngredients.forEach(i => { const idx = index.get(String(i).toLowerCase()); if (idx !== undefined) selectedVec[idx] = 1; });

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
    const score = 0.7 * Number(scores[i]) + 0.3 * (overlap / (selectedIngredients.length || 1));
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
