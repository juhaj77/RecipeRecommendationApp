# RecipeSuggestion Server — Code Documentation

This document summarizes what the server does, why it’s built this way, and the rationale behind key data structures and model choices.

## Overview
The server is a small Express application that exposes a few REST endpoints for a recipe suggestion app. It reads recipes from a CSV (via a lightweight streaming parser with caching), persists users and likes in a JSON file, and generates recipe recommendations either with a simple token‑overlap ranker or (optionally) a tiny logistic model using TensorFlow.js.

## Architecture at a Glance
- Runtime: Node.js (ESM) + Express
- Data sources:
  - `recipes_data.csv` (parsed on first access, cached in memory)
  - `data/users.json` (created on demand, file‑backed persistence)
- Recommenders:
  - Heuristic token overlap (default)
  - Optional TFJS logistic model (single sigmoid unit) when there are enough likes

## Files and Responsibilities
- `server/index.ts`
  - Boots Express, CORS, and JSON parsing.
  - Endpoints:
    - `GET /api/ingredients` → returns a curated list of ingredient tokens (primarily NER-based).
    - `POST /api/recipes` → returns recommended recipes based on selected ingredients and optional user history.
    - `POST /api/like` → stores a user’s like for a recipe.
    - `GET /api/user` → fetches user data (id, name, likes).
    - `POST /api/login` → mock login that checks email/password against local JSON.
  - Why: Minimal HTTP surface matching the client; input is validated/sanitized, and responses are trimmed to avoid excessive payloads.

- `server/lib/csv.(ts|js)`
  - Memory‑aware CSV reader tailored to the dataset. Streams the file in 64KB chunks, handles Windows newlines, and parses cells with basic quote handling.
  - Extracts arrays from stringified list columns (`ingredients`, `NER`), robust to slightly malformed JSON.
  - Exposes:
    - `parseRecipesCSV(path, {maxRows, maxBytes})` → safe bounded parser.
    - `loadAllRecipes()` → memoizes the parsed array to avoid repeated IO.
    - `allKnownIngredients(limit)` → deduped, normalized set of NER tokens for suggestions.
  - Why these structures:
    - `Set` for deduplication and O(1) membership checks.
    - One‑time `Array` cache to avoid re‑reading the CSV on each request.
    - Size caps (`maxRows`, `maxBytes`) to prevent accidental OOM on large files.

- `server/lib/users.(ts|js)`
  - Simple file‑based user store in `data/users.json` (created on demand).
  - Hashes passwords with SHA‑256 (demo‑grade; use salted, slow KDF in production).
  - Exposes CRUD‑like helpers and `addLike`.
  - Why: Keeps state small and human‑inspectable; no external DB dependency. Uses a temp file + rename for basic atomicity.

- `server/lib/model.js` (default in use)
  - Token‑based ranker: normalize tokens from recipes (`NER` entities and title words), compute overlap with user‑selected tokens. Directions text is not used for scoring. Already‑liked items can be boosted when blending with the learnable scorer.
  - Why: Fast, deterministic, and memory‑safe—ideal for sparse textual signals at this scale.
  - Data structures: `Set` per recipe for quick membership checks; `Array` for results, sorted by score.

- `server/lib/model.ts` (optional TFJS path)
  - Builds a vocabulary over NER entities and title tokens (not raw ingredients, not directions), maps each recipe to a binary bag‑of‑words vector, and trains a tiny single‑layer logistic model on‑the‑fly using user likes as positives and some non‑liked as negatives.
  - Combines model predictions with title+NER token overlap for a hybrid score.
  - Why: Demonstrates a simple learnable scorer when user feedback exists (≥2 likes), while keeping the model extremely small to control memory and latency.

## API Endpoints
- `GET /api/ingredients`
  - Returns a deduped list of normalized ingredient tokens for UI suggestions.
  - Falls back to a curated list on error or when the dataset provides too few options. Current fallback list:
    `[ 'chicken','beef','fish','tofu','minced meat','carrot','potatoes','pork','lamb','beans','milk','butter','sugar','eggs','flour','onion','tomatoes','cabbage','cheddar cheese','green pepper','garlic','sour cream','cream cheese','salt','pepper','vanilla','bacon','rice','corn' ]`. 

- `POST /api/recipes`
  - Body: `{ userId?: string, ingredients: string[], limit?: number }`
  - Normalizes input tokens, delegates to recommender, trims response fields.
  - Matching is based on title words + NER entities only. Directions text is not used for scoring.
  - All selected ingredient tokens must be present among a recipe’s NER tokens to be included in results.
  - On errors, falls back to a simple heuristic using title+NER overlap (equal weight).
  - Response `recipe` objects now include:
    - `directions` (cleaned and trimmed, up to ~800 chars) for quick preview in UI. Cleaning steps:
      - Decode unicode escapes like `\u00b0` into the actual degree symbol `°` (so temperatures like `350°F` display correctly).
      - If directions come as a JSON-like array (e.g., `["step 1", "step 2"]`), they are parsed and joined into multiple lines.
      - Strips leftover outer quotes/brackets and normalizes whitespace while preserving temperatures and text content.
    - `link` is normalized to an absolute URL to avoid being treated as a relative path on the dev host:
      - Accepts already absolute `http://` or `https://` as-is.
      - Converts protocol-relative (`//example.com/...`) to `https://example.com/...`.
      - For bare domains like `cookbooks.com/Recipe-Details.aspx?...`, prepends `https://`.
    - `likesCount` (optional number) aggregated from `data/users.json` to show how many users have liked the recipe.

- `POST /api/like`
  - Body: `{ userId: string, recipeId: number | string }`
  - Idempotently stores the like in `users.json`.

- `GET /api/user?id=...`
  - Returns a user profile (id, email, name, likes) or a suitable error.

- `POST /api/login`
  - Body: `{ email: string, password: string }`
  - Verifies against local JSON. Demo only; not production‑grade.

- `POST /api/signup`
  - Body: `{ email: string, name: string, password: string }`
  - Creates a new user in `data/users.json` (fails if email already exists). Returns `{ user }` with `id`, `email`, `name`. Demo‑grade hashing (SHA‑256) used for password; not for production.

## Normalization Rationale
Ingredient strings often contain quantities, units, and punctuation. The server normalizes to lower‑cased tokens and strips numeric amounts, unit words, and punctuation. This reduces sparsity and improves matching quality for both overlap scoring and vocabulary building.

## Recommenders
### Heuristic (default)
- Normalize recipe and query tokens and compute overlap.
- Boost recipes sharing tokens with previously liked items; strongly boost already liked recipes.
- Pros: deterministic, very fast, minimal memory.
- Data structures: `Set` for tokens and liked ids, arrays for ranking.

### TFJS Logistic (optional)
- Build vocab (`Map<string, number>`) over tokens.
- Vectorize recipes into binary bag‑of‑words arrays.
- Train a single dense layer with a sigmoid activation using likes as positives and a sample of non‑likes as negatives.
- Blend predicted probability with overlap score.
- Tensors are explicitly disposed to avoid leaks.

## Why Sigmoid Activation (TFJS model)
- The task is binary: like vs. not‑like. Sigmoid maps real‑valued logits to `[0, 1]`, interpretable as the probability of “like”.
- Pairs naturally with binary cross‑entropy loss, providing stable gradients.
- Produces bounded, calibrated scores that blend well with the heuristic overlap signal.
- A deeper or alternative activation isn’t necessary; a single sigmoid unit over sparse features behaves like classic logistic regression (simple, explainable, fast).

## Key Data Structures and Why
- `Set`
  - Used for ingredient/NER tokens and user likes.
  - O(1) insert/lookup; ideal for deduplication and membership checks.
- `Map<string, number>`
  - Vocabulary index (token → column) for deterministic, compact vectorization.
- Arrays (`number[]`, arrays of recipes)
  - Recipe vectors and score lists are contiguous arrays; cheap to iterate and sort.
- Cached arrays (CSV rows)
  - Avoid repeated disk IO and parsing; reuse a single in‑memory snapshot.
- Tensors (TFJS route)
  - `tensor2d` batches recipes for training/prediction with BLAS‑backed ops. All tensors are disposed to keep memory stable.

## Safety and Performance Notes
- Memory safety: CSV parsing is bounded; token ranker avoids huge dense matrices. The TFJS path is kept tiny and carefully disposes tensors.
- IO safety: `users.json` writes via temp file + rename to reduce corruption risk.
- API safety: Trims output fields, constrains `limit` (1–50), and handles missing/invalid inputs gracefully.

## When to Use Which Recommender
- Default (heuristic): Use when there are no or few likes. Instant and robust.
- TFJS (logistic with sigmoid): Use when a user has at least a couple of likes; can generalize beyond exact token overlap and re‑weight features toward the user’s history.

## Notes
- The default runtime path uses the heuristic recommender to minimize memory and latency.
- TensorFlow.js is available as a dependency for the optional model but should be enabled with care due to memory considerations.
