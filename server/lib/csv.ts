// CSV utilities: streamed, memory-aware parsing and lightweight indexing for ingredients.
// What: Parse the dataset safely with size caps, cache results, and expose helper queries.
// Why: Avoid loading huge files into memory and keep request-time work minimal.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

export interface CsvRecipeRow {
  id: number;
  title: string;
  ingredients: string[];
  ner?: string[];
  directions?: string;
  link?: string;
  source?: string;
  site?: string;
  score?: number;
}

// Streamed CSV reader tailored to our file
// Stream the CSV file in fixed-size chunks and parse lines with simple quote handling.
// Why: Keeps memory bounded on large files; avoids loading entire file at once.
export function parseRecipesCSV(csvPath: string, options: { maxRows?: number; maxBytes?: number } = {}): CsvRecipeRow[] {
  const MAX_ROWS = Number.isFinite(options.maxRows as number) ? (options.maxRows as number) : 20000; // including header
  const MAX_BYTES = Number.isFinite(options.maxBytes as number) ? (options.maxBytes as number) : 8 * 1024 * 1024; // 8MB safety cap

  const fd = fs.openSync(csvPath, 'r');
  try {
    const CHUNK = 64 * 1024; // 64KB
    const buf = Buffer.allocUnsafe(CHUNK);
    let carry = '';
    let bytesTotal = 0;
    const lines: string[] = [];

    outer: while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK, null);
      if (bytesRead <= 0) break;
      bytesTotal += bytesRead;
      carry += buf.toString('utf8', 0, bytesRead);

      let start = 0;
      for (let i = 0; i < carry.length; i++) {
        const ch = carry.charCodeAt(i);
        if (ch === 10 /* \n */) {
          let line = carry.slice(start, i);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.trim().length > 0) lines.push(line);
          start = i + 1;
          if (lines.length >= MAX_ROWS) {
            carry = '';
            break outer;
          }
        }
      }
      carry = carry.slice(start);

      if (bytesTotal >= MAX_BYTES) break;
    }

    if (carry && lines.length < MAX_ROWS) {
      const final = carry.trimEnd();
      if (final.trim().length > 0) lines.push(final);
    }

    if (lines.length < 2) return [];

    const header = lines[0].split(',');
    const colIndex = {
      title: header.indexOf('title'),
      ingredients: header.indexOf('ingredients'),
      directions: header.indexOf('directions'),
      link: header.indexOf('link'),
      source: header.indexOf('source'),
      ner: header.indexOf('NER'),
      site: header.indexOf('site'),
    };

    const rows: CsvRecipeRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cells: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') {
          if (inQuotes && line[j + 1] === '"') {
            cur += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          cells.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur);

      const get = (idx: number) => (idx >= 0 && idx < cells.length ? cells[idx] : '');

      const parseArray = (txt: string) => {
        if (!txt) return [] as string[];
        let t = String(txt).trim();
        if (!t) return [] as string[];

        const startTok = '["';
        const endTok = '"]';
        const start = t.indexOf(startTok);
        const end = t.lastIndexOf(endTok);
        if (start !== -1 && end !== -1 && end > start + startTok.length) {
          const inner = t.slice(start + startTok.length, end);
          const items: string[] = [];
          const re = /""(.*?)""/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(inner)) !== null) {
            const val = String(m[1]).trim().toLowerCase();
            if (val) items.push(val);
          }
          if (items.length) return items;
        }

        try {
          const arr = JSON.parse(t);
          return Array.isArray(arr) ? arr.map((s: any) => String(s).toLowerCase()) : [];
        } catch {}

        const inner = t.replace(/^\[/, '').replace(/\]$/, '');
        return inner
          .split(',')
          .map(s => s.replace(/^\s*"+|"+\s*$/g, ''))
          .map(s => s.toLowerCase())
          .filter(Boolean);
      };

      const title = get(colIndex.title);
      if (!title) continue;

      const ingredients = parseArray(get(colIndex.ingredients));
      const ner = parseArray(get(colIndex.ner));
      rows.push({
        id: i,
        title,
        ingredients,
        ner,
        directions: get(colIndex.directions),
        link: get(colIndex.link),
        source: get(colIndex.source),
        site: get(colIndex.site),
      });
    }
    return rows;
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// Cache parsed CSV in-memory to avoid repeated disk IO during requests.
let cache: CsvRecipeRow[] | null = null;
export function loadAllRecipes(): CsvRecipeRow[] {
  if (cache) return cache;
  const csvPath = path.join(projectRoot, 'recipes_data.csv');
  cache = parseRecipesCSV(csvPath, { maxRows: 20000, maxBytes: 8 * 1024 * 1024 });
  return cache;
}

// Collect a deduped set of normalized ingredient tokens from the dataset for suggestions.
export function allKnownIngredients(limit: number = 500): string[] {
  const recipes = loadAllRecipes();
  const set = new Set<string>();

  const normalize = (s: unknown) => {
    if (s == null) return '';
    let t = String(s).toLowerCase();
    t = t.replace(/\s*\([^)]*\)\s*/g, ' ');
    t = t.replace(/,\s*(washed|drained|chopped|diced|sliced|optional|softened|melted|cooked|undrained|peeled|seeded|shredded|minced|crumbled|cubed|halved|rinsed)\b.*$/g, '');
    t = t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    t = t.replace(/\s{2,}/g, ' ').trim();
    if (!t) return '';
    if (/^['’]s$/.test(t)) return '';
    if (!/[a-z]/.test(t)) return '';
    return t;
  };

  for (const r of recipes) {
    const isGathered = String(r.source || '').toLowerCase() === 'gathered';
    if (isGathered && r.ner && r.ner.length) {
      r.ner.forEach(x => {
        const n = normalize(x);
        if (n) set.add(n);
      });
    }
  }
  const arr = Array.from(set);
  arr.sort();
  return arr.slice(0, limit);
}
