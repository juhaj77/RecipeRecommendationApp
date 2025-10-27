import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import Home from './Home'
import Login from './Login'
import SignUp from './SignUp'
import styles from './App.module.scss'

export type AuthState = {
  userId: string
  userName: string
}

export type AuthContextType = AuthState & {
  setAuth: (s: Partial<AuthState>) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

export default function App() {
  const [route, setRoute] = useState<string>(window.location.hash || '#/')
  const [auth, setAuthState] = useState<AuthState>({
    userId: localStorage.getItem('userId') || '',
    userName: localStorage.getItem('userName') || '',
  })

  useEffect(() => {
    const onHash = () => {
      setRoute(window.location.hash || '#/')
      // Also refresh auth from localStorage on route changes so login page redirect updates navbar
      setAuthState({
        userId: localStorage.getItem('userId') || '',
        userName: localStorage.getItem('userName') || '',
      })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Note: 'storage' does NOT fire on the same tab that made the change, only across tabs.
  // We still listen for cross-tab updates, but within this tab we update state via context setters.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'userId' || e.key === 'userName') {
        setAuthState({
          userId: localStorage.getItem('userId') || '',
          userName: localStorage.getItem('userName') || '',
        })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setAuth = (s: Partial<AuthState>) => {
    setAuthState(prev => {
      const next = { ...prev, ...s }
      // keep localStorage in sync so Home.tsx or other pages that read it continue to work
      if (s.userId !== undefined) {
        if (s.userId) localStorage.setItem('userId', s.userId)
        else localStorage.removeItem('userId')
      }
      if (s.userName !== undefined) {
        if (s.userName) localStorage.setItem('userName', s.userName)
        else localStorage.removeItem('userName')
      }
      return next
    })
  }

  const logout = () => {
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
    setAuthState({ userId: '', userName: '' })
    window.location.hash = '#/'
  }

  const ctxValue = useMemo<AuthContextType>(() => ({
    userId: auth.userId,
    userName: auth.userName,
    setAuth,
    logout,
  }), [auth.userId, auth.userName])

  const Page = route.startsWith('#/login') ? Login : route.startsWith('#/signup') ? SignUp : Home
  const onHome = route === '#/'

  return (
    <div className="container">
      <header className={styles.header}>
        <h1>Recipe Suggestion</h1>
        <nav className={styles.nav}>
          {!onHome && <a href="#/">Home</a>}
          {auth.userId ? (
            <>
              <span className={styles.user}>Hi, {auth.userName || 'user'}</span>
              <button className="button" onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              {!route.startsWith('#/login') && <a href="#/login">Log in</a>}
              {!route.startsWith('#/signup') && <a href="#/signup">Sign up</a>}
            </>
          )}
        </nav>
      </header>
      <AuthContext.Provider value={ctxValue}>
        <Page />
      </AuthContext.Provider>
    </div>
  )
}
