import { stockDisponible, loteEstaVencido, proximoVencimiento } from '../../services/estado'

function ProductoCard({ producto, onAdd }) {
  const manejaLotes = Boolean(producto.manejaLotes)
  const disponible = manejaLotes
    ? stockDisponible(producto)
    : Math.max(producto.stock ?? 0, 0)
  const agotado = disponible <= 0

  // Está vencido si maneja lotes y no hay ningún lote con cantidad disponible y vigente.
  const vencido =
    manejaLotes &&
    Array.isArray(producto.lotes) &&
    producto.lotes.length > 0 &&
    producto.lotes.every((lote) => loteEstaVencido(lote) || (lote.cantidad ?? 0) <= 0)

  const bajo = !agotado && !vencido && producto.stockMinimo !== undefined && disponible <= producto.stockMinimo

  const claseStock = vencido
    ? 'producto__stock--vencido'
    : agotado
      ? 'producto__stock--agotado'
      : bajo
        ? 'producto__stock--bajo'
        : ''

  const fechaVencimiento = manejaLotes ? proximoVencimiento(producto) : null

  return (
    <article className={`producto${vencido ? ' producto--vencido' : ''}${agotado ? ' producto--agotado' : ''}`}>
      <div className="producto__imagen">
        <img className="producto__foto" src={producto.imagen} alt={producto.nombre} loading="lazy" />
      </div>

      <div className="producto__info">
        <h3 className="producto__nombre">{producto.nombre}</h3>
        <div className="producto__meta">
          <span className="producto__precio">{producto.precioTexto}</span>
          {fechaVencimiento && (
            <span className={`producto__vencimiento${vencido ? ' producto__vencimiento--vencido' : ''}`}>
              Vence {fechaVencimiento.toLocaleDateString('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </span>
          )}
          <span className={`producto__stock ${claseStock}`}>
            {vencido ? 'Vencido' : agotado ? 'Agotado' : `${disponible} disp.`}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="producto__add"
        onClick={() => onAdd(producto)}
        disabled={vencido || agotado}
        aria-label={
          vencido
            ? `${producto.nombre} vencido`
            : agotado
              ? `${producto.nombre} agotado`
              : `Agregar ${producto.nombre}`
        }
      >
        {vencido ? 'Vencido' : agotado ? 'No disponible' : '+'}
      </button>
    </article>
  )
}

export default ProductoCard
