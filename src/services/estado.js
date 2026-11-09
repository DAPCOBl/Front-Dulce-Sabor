import { useSyncExternalStore } from 'react'
import { productoConPrecio } from '../components/ui/format'
import { INVENTARIO, MOVIMIENTOS_INICIALES } from '../data/inventario'
import { PRODUCTOS } from '../data/menu'
import { prefijoDeCategoria } from '../data/productos'
import { VENTAS_INICIALES } from '../data/ventas'

// Estado compartido entre el rol de cajero (punto de venta) y el de
// administrador (resumen del negocio). Es la única fuente de verdad para
// el ledger de ventas y el inventario.
const CAJERO_SEMILLA = 'Ana López'
const ESTADO_KEY = 'dulcesabor:estado:v2'

const ESTADO_INICIAL = {
  ventas: VENTAS_INICIALES.map((venta) => ({
    ...venta,
    cajero: CAJERO_SEMILLA,
  })),
  productos: PRODUCTOS.map(productoConPrecio),
  // Existencia y trazabilidad del módulo de inventario.
  inventario: INVENTARIO,
  movimientos: MOVIMIENTOS_INICIALES,
  // Ingresos y ventas cobradas en la sesión actual (las suma el punto de venta).
  sesion: { ingresos: 0, ventas: 0 },
}

function cargarEstado() {
  try {
    const raw = localStorage.getItem(ESTADO_KEY)
    if (!raw) return ESTADO_INICIAL
    const guardado = JSON.parse(raw)
    if (!guardado?.ventas || !guardado?.productos) return ESTADO_INICIAL
    return { ...ESTADO_INICIAL, ...guardado, productos: reconciliarProductos(guardado.productos) }
  } catch {
    return ESTADO_INICIAL
  }
}

// Campos que el administrador puede editar de una ficha de producto.
const CAMPOS_EDITABLES = [
  'nombre',
  'sku',
  'categoria',
  'precio',
  'coste',
  'stock',
  'stockMinimo',
  'estado',
]

function fusionarProducto(canonico, guardado) {
  const producto = { ...canonico }
  if (!guardado) return producto
  for (const campo of CAMPOS_EDITABLES) {
    if (guardado[campo] !== undefined) producto[campo] = guardado[campo]
  }
  // La imagen es obligatoria: solo se respeta la guardada si existe, para no
  // perder la imagen del catálogo por estados antiguos sin foto.
  if (guardado.imagen) producto.imagen = guardado.imagen
  return producto
}

// El estado guardado puede venir de una versión anterior del catálogo: se
// rescata lo ya editado y se completan los productos que faltaban.
function reconciliarProductos(guardados) {
  const porId = new Map(guardados.map((producto) => [producto.id, producto]))
  const conocidos = new Set(PRODUCTOS.map((producto) => producto.id))
  const productos = PRODUCTOS.map((producto) => fusionarProducto(producto, porId.get(producto.id)))
  const creados = guardados.filter((producto) => !conocidos.has(producto.id))

  return [...productos, ...creados].map(productoConPrecio)
}

let estado = cargarEstado()

const suscriptores = new Set()

function getEstado() {
  return estado
}

function suscribir(callback) {
  suscriptores.add(callback)
  return () => suscriptores.delete(callback)
}

function actualizar(parcial) {
  estado = { ...estado, ...parcial }
  try {
    localStorage.setItem(ESTADO_KEY, JSON.stringify(estado))
  } catch {
    // Sin persistencia (modo privado): el estado sigue vivo en memoria.
  }
  suscriptores.forEach((callback) => callback())
}

export function useEstado() {
  return useSyncExternalStore(suscribir, getEstado, getEstado)
}

// Catálogo de productos: el punto de venta y la pantalla de productos del
// administrador leen y escriben la misma lista.
function getProductos() {
  return estado.productos
}

export function useCatalogo() {
  return useSyncExternalStore(suscribir, getProductos, getProductos)
}

// Actualiza la ficha de un producto del catálogo y su equivalente en el
// módulo de inventario, para que no queden fichas distintas del mismo
// producto en dos módulos.
export function actualizarProducto(id, cambios) {
  const productos = estado.productos.map((producto) =>
    producto.id === id ? { ...producto, ...cambios } : producto,
  )

  actualizar({
    productos: productos.map(productoConPrecio),
    inventario: estado.inventario.map((item) => {
      if (item.id !== id) return item
      return {
        ...item,
        nombre: cambios.nombre ?? item.nombre,
        sku: cambios.sku ?? item.sku,
        categoria: cambios.categoria ?? item.categoria,
        minimo: cambios.stockMinimo ?? item.minimo,
        enPos: cambios.estado ? cambios.estado === 'Activo' : item.enPos,
        ...(cambios.manejaLotes !== undefined ? { manejaLotes: cambios.manejaLotes } : {}),
        ...(cambios.lotes !== undefined ? { lotes: cambios.lotes } : {}),
      }
    }),
  })
}

// Activa o desactiva un producto del catálogo. Un producto inactivo deja de
// ofrecerse en el punto de venta.
export function alternarEstadoProducto(id) {
  const producto = estado.productos.find((item) => item.id === id)
  if (!producto) return
  actualizarProducto(id, { estado: producto.estado === 'Activo' ? 'Inactivo' : 'Activo' })
}

// Registra un producto nuevo: aparece en el punto de venta y en el catálogo
// administrable con la misma ficha.
export function crearProducto(producto) {
  actualizar({
    productos: [productoConPrecio(producto), ...estado.productos],
    inventario: [
      {
        id: producto.id,
        nombre: producto.nombre,
        sku: producto.sku,
        categoria: producto.categoria,
        stock: producto.stock ?? 0,
        minimo: producto.stockMinimo ?? 0,
        enPos: producto.estado === 'Activo',
        manejaLotes: producto.manejaLotes ?? false,
        lotes: producto.lotes ?? null,
      },
      ...estado.inventario,
    ],
  })
}

// SKU correlativo por categoría: PAN-007, PAS-006, BEB-005...
export function generarSku(categoria) {
  const prefijo = prefijoDeCategoria(categoria)
  const ultimo = estado.productos
    .filter((producto) => producto.sku.startsWith(`${prefijo}-`))
    .map((producto) => Number(producto.sku.split('-')[1]))
    .filter(Number.isFinite)
    .reduce((maximo, numero) => Math.max(maximo, numero), 0)

  return `${prefijo}-${String(ultimo + 1).padStart(3, '0')}`
}

// Registra una venta cobrada en el punto de venta: la agrega al ledger,
// descuenta el inventario y suma los ingresos de la sesión.
// Cuando el producto maneja lotes, descuenta por FIFO de vencimiento
// (se vende primero el lote que vence primero).
export function registrarVenta(venta, cajero) {
  const items = venta.items ?? []

  const productosActualizados = estado.productos.map((producto) => {
    const item = items.find((registro) => registro.id === producto.id)
    if (!item) return producto

    if (producto.manejaLotes && Array.isArray(producto.lotes)) {
      let restante = item.cantidad
      const nuevosLotes = producto.lotes
        .slice()
        .sort((a, b) => {
          const fa = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : Infinity
          const fb = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : Infinity
          return fa - fb
        })
        .map((lote) => {
          if (restante <= 0) return lote
          const disponible = Math.max(lote.cantidad ?? 0, 0)
          const consumir = Math.min(restante, disponible)
          restante -= consumir
          return { ...lote, cantidad: disponible - consumir }
        })

      return {
        ...producto,
        stock: Math.max(producto.stock - item.cantidad, 0),
        lotes: nuevosLotes,
      }
    }

    return { ...producto, stock: Math.max(producto.stock - item.cantidad, 0) }
  })

  actualizar({
    ventas: [{ ...venta, cajero }, ...estado.ventas],
    productos: productosActualizados.map(productoConPrecio),
    inventario: estado.inventario.map((item) => {
      const producto = productosActualizados.find((p) => p.id === item.id)
      if (!producto) return item
      return {
        ...item,
        stock: producto.stock,
        manejaLotes: producto.manejaLotes ?? false,
        lotes: producto.lotes ?? null,
      }
    }),
    sesion: {
      ingresos: estado.sesion.ingresos + venta.importe,
      ventas: estado.sesion.ventas + 1,
    },
  })
}

// Estado de una existencia frente a su mínimo: agotado, bajo o disponible.
export function estadoDeInventario(producto) {
  if (producto.stock <= 0) return 'agotado'
  if (producto.stock <= producto.minimo) return 'bajo'
  return 'disponible'
}

// ---------- Utilidades de lotes y vencimiento ----------

function esFechaValida(fecha) {
  return Boolean(fecha) && !Number.isNaN(new Date(fecha).getTime())
}

function fechaISO(fecha) {
  const d = new Date(fecha)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Cantidad disponible en lotes vigentes (no vencidos) o stock plano si no maneja lotes.
export function stockDisponible(producto, hoy = new Date()) {
  if (!producto.manejaLotes || !Array.isArray(producto.lotes)) {
    return Math.max(producto.stock ?? 0, 0)
  }
  const hoyInicio = new Date(hoy)
  hoyInicio.setHours(0, 0, 0, 0)
  return producto.lotes
    .filter((lote) => esFechaValida(lote.fechaVencimiento) && new Date(lote.fechaVencimiento) >= hoyInicio)
    .reduce((acc, lote) => acc + Math.max(lote.cantidad ?? 0, 0), 0)
}

// Fecha de vencimiento más cercana entre los lotes del producto.
export function proximoVencimiento(producto) {
  if (!producto.manejaLotes || !Array.isArray(producto.lotes) || producto.lotes.length === 0) {
    return null
  }
  const fechas = producto.lotes
    .filter((lote) => esFechaValida(lote.fechaVencimiento))
    .map((lote) => new Date(lote.fechaVencimiento))
  if (fechas.length === 0) return null
  return fechas.sort((a, b) => a - b)[0]
}

// ¿Un lote ya venció?
export function loteEstaVencido(lote, hoy = new Date()) {
  if (!esFechaValida(lote.fechaVencimiento)) return false
  const hoyInicio = new Date(hoy)
  hoyInicio.setHours(0, 0, 0, 0)
  return new Date(lote.fechaVencimiento) < hoyInicio
}

// ¿Un lote vence pronto (dentro de los próximos `dias`)?
export function loteVencePronto(lote, hoy = new Date(), dias = 7) {
  if (!esFechaValida(lote.fechaVencimiento)) return false
  const fechaVence = new Date(lote.fechaVencimiento)
  fechaVence.setHours(0, 0, 0, 0)
  const hoyInicio = new Date(hoy)
  hoyInicio.setHours(0, 0, 0, 0)
  const limite = new Date(hoyInicio)
  limite.setDate(limite.getDate() + dias)
  return fechaVence >= hoyInicio && fechaVence <= limite
}

// Productos con lotes vencidos o por vencer.
export function alertasDeVencimiento(productos, hoy = new Date(), dias = 7) {
  const vencidos = []
  const porVencer = []

  for (const producto of productos) {
    if (!producto.manejaLotes || !Array.isArray(producto.lotes) || producto.lotes.length === 0) {
      continue
    }
    const tieneVencido = producto.lotes.some((lote) => loteEstaVencido(lote, hoy))
    const tienePronto = producto.lotes.some((lote) => loteVencePronto(lote, hoy, dias))

    if (tieneVencido) {
      vencidos.push({
        id: producto.id,
        nombre: producto.nombre,
        sku: producto.sku,
        lotesVencidos: producto.lotes.filter((lote) => loteEstaVencido(lote, hoy)).length,
      })
    } else if (tienePronto) {
      porVencer.push({
        id: producto.id,
        nombre: producto.nombre,
        sku: producto.sku,
        proximoVencimiento: fechaISO(proximoVencimiento(producto)),
      })
    }
  }

  vencidos.sort((a, b) => a.nombre.localeCompare(b.nombre))
  porVencer.sort((a, b) => (a.proximoVencimiento || '').localeCompare(b.proximoVencimiento || ''))

  return { vencidos, porVencer }
}

function siguienteReferencia(movimientos) {
  const mayor = movimientos.reduce((maximo, movimiento) => {
    const numero = Number(String(movimiento.referencia).replace(/\D/g, ''))
    return Number.isFinite(numero) && numero > maximo ? numero : maximo
  }, 1044)
  return `MOV-${mayor + 1}`
}

function horaCorta(date) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// Registra un movimiento de inventario: actualiza la existencia del producto
// (y su equivalente en el punto de venta) y lo deja trazado en el historial.
// Cuando `tipo === 'entrada'` y el producto maneja lotes, se puede pasar
// `loteId` para sumar a un lote existente o `fechaVencimiento` para crear
// un lote nuevo.
export function registrarMovimiento({
  productoId,
  cantidad,
  tipo,
  motivo,
  responsable,
  loteId,
  fechaVencimiento,
}) {
  const producto = estado.inventario.find((item) => item.id === productoId)
  if (!producto) return null

  const unidades = Math.max(Math.round(cantidad), 0)
  const ahora = new Date()

  let nuevoStock
  let productosLotes

  if (tipo === 'entrada' && producto.manejaLotes) {
    // Busca el producto maestro en el catálogo para manipular sus lotes.
    const maestro = estado.productos.find((item) => item.id === productoId)
    if (!maestro) return null

    let lotes = maestro.lotes ? [...maestro.lotes] : []
    let loteEncontrado

    if (loteId) {
      loteEncontrado = lotes.find((l) => l.id === loteId)
      if (loteEncontrado) {
        loteEncontrado = { ...loteEncontrado, cantidad: (loteEncontrado.cantidad ?? 0) + unidades }
        lotes = lotes.map((l) => (l.id === loteId ? loteEncontrado : l))
      }
    }

    if (!loteEncontrado && fechaVencimiento) {
      const nuevoLote = {
        id: `lote-${ahora.getTime()}`,
        fechaVencimiento,
        cantidad: unidades,
        fechaEntrada: fechaISO(ahora),
      }
      lotes = [...lotes, nuevoLote]
    }

    productosLotes = lotes
    nuevoStock = maestro.stock + unidades
  } else {
    // Una entrada suma al stock; un ajuste fija el conteo físico como nuevo saldo.
    nuevoStock = tipo === 'entrada' ? producto.stock + unidades : unidades
  }

  const movimiento = {
    id: `mov-${ahora.getTime()}`,
    hora: horaCorta(ahora),
    referencia: siguienteReferencia(estado.movimientos),
    tipo,
    productoId: producto.id,
    producto: producto.nombre,
    sku: producto.sku,
    cambio: nuevoStock - producto.stock,
    saldo: nuevoStock,
    responsable,
    motivo,
    ...(loteId ? { loteId } : {}),
    ...(fechaVencimiento ? { fechaVencimiento } : {}),
  }

  actualizar({
    inventario: estado.inventario.map((item) => {
      if (item.id !== producto.id) return item
      return {
        ...item,
        stock: nuevoStock,
        ...(productosLotes !== undefined ? { lotes: productosLotes } : {}),
      }
    }),
    productos: estado.productos.map((item) => {
      if (item.id !== producto.id) return item
      return {
        ...item,
        stock: nuevoStock,
        ...(productosLotes !== undefined ? { lotes: productosLotes } : {}),
      }
    }),
    movimientos: [movimiento, ...estado.movimientos],
  })

  return movimiento
}

// Alertas de inventario mínimo: agotado (sin unidades) y stock bajo.
export function alertasDeInventario(productos) {
  return productos
    .filter((producto) => producto.stock <= 0 || producto.stock <= producto.stockMinimo)
    .map((producto) => ({
      id: producto.id,
      nombre: producto.nombre,
      estado: producto.stock <= 0 ? 'agotado' : 'bajo',
      stock: producto.stock,
      minimo: producto.stockMinimo,
    }))
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'agotado' ? -1 : 1
      return a.stock - b.stock
    })
}
