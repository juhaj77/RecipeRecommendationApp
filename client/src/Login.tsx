import React, { useState, useEffect } from 'react'
import styles from './Login.module.scss'
import { useAuth } from './App.tsx'

export default function Login() {
  const { setAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    setError('')
    setOk('')
  }, [email, password])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setOk('')
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      const user = data.user
      const derivedName = (user && user.name) ? user.name : (email.split('@')[0] || '')
      localStorage.setItem('userId', user.id)
      if (derivedName) localStorage.setItem('userName', derivedName)
      // Update context immediately so navbar reacts in the same tab without relying on 'storage' event
      setAuth({ userId: user.id, userName: derivedName })
      setOk('Kirjautuminen onnistui!')
      // Redirect to home so navbar updates and user can start searching
      window.location.hash = '#/'
    } catch (e: any) {
      setError(e.message || 'Virhe')
    }
  }

  return (
    <main>
      <div className="card">
        <h2>Kirjaudu sisään</h2>
        <form onSubmit={submit}>
          <label>Sähköposti</label>
          <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <label>Salasana</label>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button className="button" type="submit">Kirjaudu</button>
        </form>
        {error && <div className={styles.messageError}>{error}</div>}
        {ok && <div className={styles.messageOk}>{ok}</div>}
      </div>
      <div className={styles.back}>
        <a href="#/">Takaisin etusivulle</a>
      </div>
    </main>
  )
}
