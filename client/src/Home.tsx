import React, { useEffect, useMemo, useState } from 'react'
import styles from './Home.module.scss'
import type { RecipesResponse } from '../../types/index.d.ts'

export default function Home() {
  const [allIngr, setAllIngr] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [userId, setUserId] = useState('')
  const [user, setUser] = useState<any>(null)
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Local fallback list to ensure suggestions cover full alphabet if server returns few
    const common = [
      'chicken','beef','fish','tofu','minced meat','carrot','potatoes','pork','lamb','beans','milk','butter','sugar','eggs','flour','onion','tomatoes','cabbage','cheddar cheese',
      'green pepper','garlic','sour cream','cream cheese','salt','pepper','vanilla','bacon','rice','corn'
    ]
    fetch('/api/ingredients')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d.ingredients) ? d.ingredients : []
        // Merge server list with fallback and de-duplicate
        const merged = Array.from(new Set([
          ...common,
          ...list
        ]))
        setAllIngr(merged)
      })
      .catch(() => setAllIngr(common))
    const uid = localStorage.getItem('userId') || ''
    setUserId(uid)
  }, [])

  useEffect(() => {
    if (!userId) {
      setUser(null)
      return
    }
    let cancelled = false
    fetch(`/api/user?id=${encodeURIComponent(userId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled) setUser(d && d.user ? d.user : null)
      })
      .catch(() => { if (!cancelled) setUser(null) })
    return () => { cancelled = true }
  }, [userId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allIngr.filter(x => !selected.includes(x)).slice(0, 30)
    return allIngr.filter(i => i.toLowerCase().includes(q) && !selected.includes(i)).slice(0, 30)
  }, [query, allIngr, selected])

  const addIngr = (i: string) => {
    const t = String(i).trim()
    if (!t) return
    console.log(t)
    if (!selected.includes(t)) setSelected([...selected, t])
    setQuery('')
  }
  const removeIngr = (i: string) => setSelected(selected.filter(x => x !== i))

  const canAddCustom = query.trim().length > 0 && !selected.includes(query.trim())
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canAddCustom) {
      e.preventDefault()
      addIngr(query.trim())
    }
  }

  const search = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ingredients: selected, limit: 10 })
      })
      const data: RecipesResponse = await res.json()
      if ((data as any) && (data as any).error && (!data.recipes || data.recipes.length === 0)) {
        setError((data as any).error as string)
      }
      setResults(data.recipes || [])
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  const like = async (recipeId: number | string) => {
    if (!userId) {
      alert('Please log in or sign up first to save your preferences.')
      return
    }
    try {
      await fetch('/api/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, recipeId }) })
      alert('Added to favorites! Future recommendations will improve.')
    } catch {
      alert('Error adding to favorites')
    }
  }

  return (
    <main>
      <div>
        <h2>Select ingredients</h2>
        <div className={styles.rowAlign}>
          <input className="input" placeholder="Search ingredients (e.g., chicken, onion)" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onInputKeyDown} />
          <button className="button" onClick={search} disabled={loading}>{loading ? 'Searching...' : 'Search recipes'}</button>
          {canAddCustom && (
            <button className="button" onClick={() => addIngr(query.trim())}>Add "{query.trim()}"</button>
          )}
        </div>
        <div className={styles.mb8}>
          {selected.map(i => (
            <span key={i}>{i} <a href="#" onClick={(e)=>{e.preventDefault();removeIngr(i);}} className={styles.badgeRemoveLink}>×</a></span>
          ))}
        </div>
        {filtered.length > 0 && (
          <div>
            {filtered.map(i => (
              <button key={i} className={`button ${styles.pill}`} onClick={()=>addIngr(i)}>{i}</button>
            ))}
          </div>
        )}
      </div>

      {error && <div className={`card ${styles.error}`}>{error}</div>}

      <div className="card">
        <h2>Results</h2>
        {results.length === 0 && <div>No results yet. Select ingredients and search.</div>}
        <div>
          {results.map((r: any) => (
            <div key={r.id} className="card">
              <div className={styles.resultRow}>
                <div>
                  <div className={styles.title}>{r.title}</div>
                  <div className={styles.ingredients}>{(r.ingredients||[]).join(', ')}{r.ingredientsTruncated ? '...' : ''}</div>
                  <div className={styles.metrics}>
                    {typeof r.score === 'number' && <span>score: {r.score.toFixed(3)}</span>}
                    {typeof r.likesCount === 'number' && <span className={styles.likes}>likes: {r.likesCount}</span>}
                  </div>
                  {r.site && <div className={styles.muted}>source: {r.site}</div>}
                  {r.directions && (
                    <div className={styles.muted} style={{ whiteSpace: 'pre-wrap', marginTop: '6px' }}>
                      {String(r.directions).length > 600 ? String(r.directions).slice(0, 600) + '…' : r.directions}
                    </div>
                  )}
                </div>
                <div className={styles.actions}>
                  {r.link && <a className="button" href={r.link} target="_blank" rel="noreferrer">Open recipe</a>}
                  <button className="button" onClick={()=>like(r.id)}>Like</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
