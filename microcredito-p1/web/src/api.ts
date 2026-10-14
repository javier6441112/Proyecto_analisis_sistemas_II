/**
 * Cliente HTTP de la API REST. Los tipos vienen del contrato Zod del backend
 * (`src/contratos/api.ts`), el mismo que publica docs/api/openapi.yaml: solo se importan
 * tipos, así que nada de Zod llega al navegador.
 */
import type {
  TAltaClienteBody, TAsesor, TCarteraTablero, TCierre, TCliente, TDesembolsoBody, TDetalleCredito,
  TExplicacionMora, TListadoCreditos, TListadoMora, TPagoAplicadoRespuesta, TPagoBody, TPagoDuplicadoRespuesta,
  TPlanBody, TPlanCredito, TPlanSimulado, TProblema, TPropuesta, TResolucionBody, TRespuestaChat, TSimulacionPago,
  TSolicitud, TSolicitudBody, TSolicitudCreada, TVencimientos,
} from '../../src/contratos/api';

export type * from '../../src/contratos/api';

export interface Operador {
  perfil: 'asesor' | 'gerencia';
  usuario: string;
}

/** Error de la API con el cuerpo RFC 9457 (`codigo`, `detail`, `errores`…). */
export class ErrorApi extends Error {
  constructor(readonly status: number, readonly problema: TProblema) {
    super(problema.detail || problema.title);
    this.name = 'ErrorApi';
  }
}

let operador: Operador | null = null;
export function fijarOperador(o: Operador | null): void {
  operador = o;
}

async function pedir<T>(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const cabeceras: Record<string, string> = { Accept: 'application/json', ...extra };
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (operador) {
    cabeceras['X-Perfil'] = operador.perfil;
    cabeceras['X-Usuario'] = operador.usuario;
  }
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  } catch {
    throw new ErrorApi(0, {
      type: 'about:blank', title: 'Sin conexión', status: 503, codigo: 'SIN_CONEXION',
      detail: 'No se pudo contactar al servidor. Verifique que la API esté en ejecución (npm run api).',
    });
  }
  if (respuesta.status === 204) return undefined as T;
  const texto = await respuesta.text();
  const datos: unknown = texto ? JSON.parse(texto) : undefined;
  if (!respuesta.ok) {
    const p = (datos ?? {}) as Partial<TProblema>;
    throw new ErrorApi(respuesta.status, {
      type: p.type ?? 'about:blank',
      title: p.title ?? `Error ${respuesta.status}`,
      status: respuesta.status,
      detail: p.detail ?? respuesta.statusText,
      codigo: p.codigo ?? 'ERROR',
      ...p,
    });
  }
  return datos as T;
}

const q = (params: Record<string, string | number | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
};
const e = encodeURIComponent;

export const api = {
  asesores: () => pedir<TAsesor[]>('GET', '/api/asesores'),
  clientes: (texto?: string) => pedir<TCliente[]>('GET', `/api/clientes${q({ q: texto })}`),
  registrarCliente: (b: TAltaClienteBody) => pedir<TCliente>('POST', '/api/clientes', b),

  creditos: (fechaCorte: string, filtros: { q?: string; idAsesor?: string } = {}) =>
    pedir<TListadoCreditos>('GET', `/api/creditos${q({ fechaCorte, ...filtros })}`),
  credito: (id: string, fechaCorte: string) => pedir<TDetalleCredito>('GET', `/api/creditos/${e(id)}${q({ fechaCorte })}`),
  planCredito: (id: string, fechaCorte: string) => pedir<TPlanCredito>('GET', `/api/creditos/${e(id)}/plan${q({ fechaCorte })}`),
  mora: (id: string, cuota: number, fechaCorte: string) =>
    pedir<TExplicacionMora>('GET', `/api/creditos/${e(id)}/cuotas/${cuota}/mora${q({ fechaCorte })}`),

  simularPlan: (b: TPlanBody) => pedir<TPlanSimulado>('POST', '/api/simulaciones/plan', b),
  solicitudes: () => pedir<TSolicitud[]>('GET', '/api/solicitudes'),
  crearSolicitud: (b: TSolicitudBody) => pedir<TSolicitudCreada>('POST', '/api/solicitudes', b),
  resolverSolicitud: (id: string, b: TResolucionBody) => pedir<TSolicitud>('POST', `/api/solicitudes/${e(id)}/resolucion`, b),
  desembolsar: (id: string, b: TDesembolsoBody) => pedir<TDetalleCredito>('POST', `/api/solicitudes/${e(id)}/desembolso`, b),

  exigible: (idCredito: string, fechaPago: string) => pedir<TSimulacionPago>('POST', '/api/pagos/simulacion', { idCredito, fechaPago }),
  simularPago: (idCredito: string, fechaPago: string, monto: string, claveIdempotencia?: string) =>
    pedir<TSimulacionPago>('POST', '/api/pagos/simulacion', { idCredito, fechaPago, monto, ...(claveIdempotencia ? { claveIdempotencia } : {}) }),
  registrarPago: (idCredito: string, b: TPagoBody, claveIdempotencia: string) =>
    pedir<TPagoAplicadoRespuesta | TPagoDuplicadoRespuesta>('POST', `/api/creditos/${e(idCredito)}/pagos`, b, { 'Idempotency-Key': claveIdempotencia }),

  cartera: (fechaCorte: string) => pedir<TCarteraTablero>('GET', `/api/cartera${q({ fechaCorte })}`),
  carteraMora: (fechaCorte: string, tramo?: string) => pedir<TListadoMora>('GET', `/api/cartera/mora${q({ fechaCorte, tramo })}`),
  vencimientos: (fechaCorte: string, dias: number) => pedir<TVencimientos>('GET', `/api/vencimientos${q({ fechaCorte, dias })}`),
  cierre: (periodo: string) => pedir<TCierre>('GET', `/api/cierres/${e(periodo)}`),
  ejecutarCierre: (periodo: string) => pedir<TCierre>('POST', `/api/cierres/${e(periodo)}/ejecucion`),

  chat: (mensaje: string, fechaOperacion: string, sesionId?: string) =>
    pedir<TRespuestaChat>('POST', '/api/chat', { mensaje, fechaOperacion, ...(sesionId ? { sesionId } : {}) }),
  olvidarChat: (sesionId: string) => pedir<void>('DELETE', `/api/chat/${e(sesionId)}`),
  aprobarPropuesta: (id: string) => pedir<Record<string, unknown>>('POST', `/api/propuestas/${e(id)}/aprobacion`),
  rechazarPropuesta: (id: string) => pedir<TPropuesta>('POST', `/api/propuestas/${e(id)}/rechazo`),
};

/** Mensaje legible de cualquier error (con los errores de campo si los hay). */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) {
    const campos = error.problema.errores?.map((x) => `${x.campo}: ${x.mensaje}`).join(' · ');
    return campos ? `${error.problema.detail} (${campos})` : error.problema.detail;
  }
  return error instanceof Error ? error.message : String(error);
}
