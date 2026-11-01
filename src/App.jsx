import { useState } from 'react'
import Login from './pages/Login'
import { getSession, logout } from './services/auth'

function App() {
  const [session, setSession] = useState(getSession)
  if (!session) return <Login onLogin={setSession} />
  return (
    <div style={{padding:20}}>
      <p>Bienvenido, {session.user.nombre}</p>
      <button onClick={() => { logout(); setSession(null) }}>Salir</button>
    </div>
  )
}

export default App
