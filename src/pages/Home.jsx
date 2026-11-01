function Home({ session, onLogout }) {
  return (
    <div style={{padding:20}}>
      <h1>Hola, {session.user.nombre}</h1>
      <button onClick={onLogout}>Cerrar sesion</button>
    </div>
  )
}

export default Home
