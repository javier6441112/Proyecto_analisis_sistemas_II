/**
 * Convención uniforme de errores (RFC 9457, ProblemDetailsSchema de src/contratos) con la
 * extensión `codigo`, que es la misma que reciben el servidor MCP y el chat.
 */
import { ZodError } from 'zod';
import { ErrorIntegridadCartera, ErrorNegocio, type CodigoError } from '../persistencia/adaptador-nucleo.js';

export interface Problema {
  type: string;
  title: string;
  status: number;
  detail: string;
  codigo: CodigoError | 'ERROR_INTERNO' | 'INTEGRIDAD_CARTERA' | 'NO_AUTORIZADO' | 'NO_AUTENTICADO';
  errores?: Array<{ campo: string; mensaje: string }>;
  [extra: string]: unknown;
}

const ESTADO: Record<CodigoError, number> = {
  FECHA_INVALIDA: 400,
  DATOS_INVALIDOS: 400,
  MONTO_INVALIDO: 400,
  CREDITO_INEXISTENTE: 404,
  CREDITO_NO_DESEMBOLSADO_A_LA_FECHA: 404,
  CUOTA_INEXISTENTE: 404,
  ENTIDAD_INEXISTENTE: 404,
  CUOTA_YA_PAGADA: 409,
  CUOTA_NO_VENCIDA: 409,
  ENTIDAD_DUPLICADA: 409,
  CLAVE_EN_CONFLICTO: 409,
  TRANSICION_INVALIDA: 409,
  FECHA_ANTERIOR_A_ULTIMO_PAGO: 409,
  MONTO_NO_EXACTO: 422,
  CREDITO_INCOBRABLE: 422,
  CREDITO_CANCELADO: 422,
  APROBACION_REQUERIDA: 428,
};

const TITULO: Record<CodigoError, string> = {
  FECHA_INVALIDA: 'Fecha inválida',
  DATOS_INVALIDOS: 'Datos inválidos',
  MONTO_INVALIDO: 'Monto inválido',
  CREDITO_INEXISTENTE: 'Crédito inexistente',
  CREDITO_NO_DESEMBOLSADO_A_LA_FECHA: 'El crédito no existía a la fecha de corte',
  CUOTA_INEXISTENTE: 'Cuota inexistente',
  ENTIDAD_INEXISTENTE: 'Registro inexistente',
  CUOTA_YA_PAGADA: 'Cuota ya pagada',
  CUOTA_NO_VENCIDA: 'Cuota no vencida',
  ENTIDAD_DUPLICADA: 'Registro duplicado',
  CLAVE_EN_CONFLICTO: 'Clave de idempotencia en conflicto',
  TRANSICION_INVALIDA: 'Transición de estado inválida',
  FECHA_ANTERIOR_A_ULTIMO_PAGO: 'Fecha anterior al último pago',
  MONTO_NO_EXACTO: 'Monto no exacto',
  CREDITO_INCOBRABLE: 'Crédito incobrable',
  CREDITO_CANCELADO: 'Crédito cancelado',
  APROBACION_REQUERIDA: 'Aprobación humana requerida',
};

function tipo(codigo: string): string {
  return `https://creditovecino.local/problemas/${codigo.toLowerCase().replace(/_/g, '-')}`;
}

export function aProblema(error: unknown): Problema {
  if (error instanceof ErrorNegocio) {
    return {
      type: tipo(error.codigo),
      title: TITULO[error.codigo],
      status: ESTADO[error.codigo],
      detail: error.message,
      codigo: error.codigo,
      ...(error.detalle ?? {}),
    };
  }
  if (error instanceof ZodError) {
    return {
      type: tipo('DATOS_INVALIDOS'),
      title: TITULO.DATOS_INVALIDOS,
      status: 400,
      detail: 'La solicitud no cumple el esquema',
      codigo: 'DATOS_INVALIDOS',
      errores: error.issues.map((i) => ({ campo: i.path.join('.') || '(cuerpo)', mensaje: i.message })),
    };
  }
  if (error instanceof ErrorIntegridadCartera) {
    return { type: tipo('INTEGRIDAD_CARTERA'), title: 'Integridad de la cartera', status: 500, detail: error.message, codigo: 'INTEGRIDAD_CARTERA' };
  }
  const statusFastify = (error as { statusCode?: number }).statusCode;
  if (statusFastify === 401) {
    return { type: tipo('NO_AUTENTICADO'), title: 'Sesión requerida', status: 401, detail: (error as Error).message, codigo: 'NO_AUTENTICADO' };
  }
  if (statusFastify &&statusFastify >= 400 && statusFastify < 500) {
    return { type: tipo('DATOS_INVALIDOS'), title: TITULO.DATOS_INVALIDOS, status: statusFastify, detail: (error as Error).message, codigo: 'DATOS_INVALIDOS' };
  }
  return { type: tipo('ERROR_INTERNO'), title: 'Error interno', status: 500, detail: 'Ocurrió un error inesperado', codigo: 'ERROR_INTERNO' };
}
