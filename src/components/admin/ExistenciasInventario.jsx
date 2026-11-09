import Buscador from '../ui/Buscador'
import Paginacion from '../ui/Paginacion'
import { Select } from '../ui/Filtro'
import { CATEGORIAS_INVENTARIO } from '../../data/inventario'
import { proximoVencimiento, loteEstaVencido } from '../../services/estado'

const ESTADOS_FILTRO = [
  { id: 'todos', etiqueta: 'todos' },
  { id: 'disponible', etiqueta: 'Disponible' },
  { id: 'bajo', etiqueta: 'Bajo' },
  { id: 'agotado', etiqueta: 'Agotado' },
]

const ESTADOS_VENCIMIENTO = [
  { id: 'todos', etiqueta: 'Vencimiento: todos' },
  { id: 'vencido', etiqueta: 'Vencidos' },
  { id: 'porVencer', etiqueta: 'Por vencer (7 días)' },
  { id: 'vigente', etiqueta: 'Vigentes' },
]

const OPCIONES_CATEGORIA = [
  { valor: 'todas', etiqueta: 'todas' },
  ...CATEGORIAS_INVENTARIO.map((categoria) => ({ valor: categoria, etiqueta: categoria })),
]

const OPCIONES_ESTADO = ESTADOS_FILTRO.map((estado) => ({
  valor: estado.id,
  etiqueta: estado.etiqueta,
}))

const ETIQUETA_ESTADO = {
  disponible: 'Disponible',
  bajo: 'Bajo',
  agotado: 'Agotado',
}

function filtrarPorVencimiento(productos, estado) {
  if (estado === 'todos') return productos
  return productos.filter((producto) => {
    if (!producto.manejaLotes || !Array.isArray(producto.lotes) || producto.lotes.length === 0) {
      return estado === 'todos' || estado === 'vigente'
    }
    const tieneVencido = producto.lotes.some((lote) => loteEstaVencido(lote))
    const tienePronto = producto.lotes.some(
      (lote) =>
        !loteEstaVencido(lote) &&
        new Date(lote.fechaVencimiento) <=
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    )
    if (estado === 'vencido') return tieneVencido
    if (estado === 'porVencer') return tienePronto && !tieneVencido
    if (estado === 'vigente') return !tieneVencido && !tienePronto
    return true
  })
}

function ExistenciasInventario({
  productos,
  total,
  porPagina,
  filtros,
  onFiltro,
  pagina,
  paginas,
  onPagina,
  onElegir,
}) {
  const productosFiltradosVencimiento = filtrarPorVencimiento(productos, filtros.vencimiento)
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)

  return (
    <section className="admin__tarjeta">
      <header className="admin__tarjeta-header">
        <div>
          <h2 className="admin__tarjeta-titulo">Existencias actuales</h2>
          <p className="admin__tarjeta-sub">Control de stock por producto en sede principal</p>
        </div>
      </header>

      <div className="ui__filtros">
        <Buscador
          valor={filtros.busqueda}
          onChange={(valor) => onFiltro('busqueda', valor)}
          placeholder="Buscar por nombre o SKU..."
          etiqueta="Buscar producto por nombre o SKU"
        />

        <label className="admin__filtro-campo">
          <span className="admin__filtro-campo-label">Categoría:</span>
          <Select
            valor={filtros.categoria}
            onChange={(valor) => onFiltro('categoria', valor)}
            opciones={OPCIONES_CATEGORIA}
            ariaLabel="Filtrar por categoría"
          />
        </label>

        <label className="admin__filtro-campo">
          <span className="admin__filtro-campo-label">Estado:</span>
          <Select
            valor={filtros.estado}
            onChange={(valor) => onFiltro('estado', valor)}
            opciones={OPCIONES_ESTADO}
            ariaLabel="Filtrar por estado"
          />
        </label>

        <label className="admin__filtro-campo">
          <span className="admin__filtro-campo-label">Vencimiento:</span>
          <Select
            valor={filtros.vencimiento}
            onChange={(valor) => onFiltro('vencimiento', valor)}
            opciones={ESTADOS_VENCIMIENTO}
            ariaLabel="Filtrar por vencimiento"
          />
        </label>
      </div>

      <div className="ui__tabla-wrap">
        <table className="ui__tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Categoría</th>
              <th>Stock actual</th>
              <th>Mínimo</th>
              <th>Estado</th>
              <th>Vencimiento</th>
            </tr>
          </thead>
          <tbody>
            {productosFiltradosVencimiento.map((producto) => (
              <tr key={producto.id}>
                <td>
                  <button
                    type="button"
                    className="admin__producto-nombre"
                    onClick={() => onElegir(producto)}
                    title={`Registrar movimiento de ${producto.nombre}`}
                  >
                    {producto.nombre}
                  </button>
                </td>
                <td className="admin__sku">{producto.sku}</td>
                <td className="admin__celda-suave">{producto.categoria}</td>
                <td>
                  <span className="admin__stock">{producto.stock}</span>
                </td>
                <td>
                  <span className="admin__minimo">{producto.minimo}</span>
                </td>
                <td>
                  <span className={`admin__badge admin__badge--${producto.estado}`}>
                    {ETIQUETA_ESTADO[producto.estado]}
                  </span>
                </td>
                <td className="admin__col-vencimiento">
                  {producto.manejaLotes && Array.isArray(producto.lotes) && producto.lotes.length > 0 ? (
                    <>
                      {proximoVencimiento(producto) ? (
                        <span
                          className={`admin__vencimiento${
                            producto.lotes.some((l) => loteEstaVencido(l))
                              ? ' admin__vencimiento--vencido'
                              : ''
                          }`}>
                          {proximoVencimiento(producto)?.toLocaleDateString('es-CO', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </span>
                      ) : (
                        <span className="admin__vencimiento admin__vencimiento--sin-fecha">
                          Sin fecha
                        </span>
                      )}
                      <span className="admin__vencimiento-cantidad">
                        {producto.lotes.reduce((acc, l) => acc + (l.cantidad ?? 0), 0)} ud.
                      </span>
                    </>
                  ) : (
                    <span className="admin__vencimiento admin__vencimiento--sin-lote">—</span>
                  )}
                </td>
              </tr>
            ))}

            {productosFiltradosVencimiento.length === 0 && (
              <tr>
                <td colSpan={7} className="admin__celda-vacia">
                  Ningún producto coincide con los filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="admin__paginacion">
        <Paginacion
          pagina={pagina}
          paginas={paginas}
          onPagina={onPagina}
          texto={`Mostrando ${desde}-${hasta} de ${total} productos`}
        />
      </footer>
    </section>
  )
}

export default ExistenciasInventario
