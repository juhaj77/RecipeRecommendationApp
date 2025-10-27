import React, { useEffect, useState } from 'react'
import styles from './Login.module.scss'
import { useAuth } from './App.tsx'

export default function SignUp() {
  const { setAuth } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setError('')
    setOk('')
  }, [name, email, password])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setOk('')
    if (!name.trim()) { setError('Nimi vaaditaan'); return }
    if (!email.trim()) { setError('Sähköposti vaaditaan'); return }
    if (!password.trim()) { setError('Salasana vaaditaan'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Rekisteröinti epäonnistui')
      const user = data.user
      // Persist and update context
      localStorage.setItem('userId', user.id)
      if (user?.name) localStorage.setItem('userName', user.name)
      setAuth({ userId: user.id, userName: user.name || '' })
      setOk('Rekisteröinti onnistui!')
      window.location.hash = '#/'
    } catch (e: any) {
      setError(e.message || 'Virhe')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <div className="card">
        <h2>Luo tili</h2>
        <form onSubmit={submit}>
          <label>Nimi</label>
          <input className="input" type="text" value={name} onChange={e=>setName(e.target.value)} required />
          <label>Sähköposti</label>
          <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <label>Salasana</label>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button className="button" type="submit" disabled={loading}>{loading ? 'Luodaan...' : 'Rekisteröidy'}</button>
        </form>
        {error && <div className={styles.messageError}>{error}</div>}
        {ok && <div className={styles.messageOk}>{ok}</div>}
      </div>
      <div className={styles.back}>
        <a href="#/login">Onko sinulla jo tili? Kirjaudu</a>
      </div>
    </main>
  )
}
