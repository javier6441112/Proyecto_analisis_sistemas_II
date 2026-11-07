/**
 * Aprobación humana de acciones sensibles (registrar un pago).
 *
 * Flujo (menor privilegio):
 *  1. El asistente llama `proponer_pago`: se valida contra el núcleo y queda una propuesta
 *     PENDIENTE. No se escribe nada.
 *  2. La interfaz muestra la propuesta con su desglose; solo una persona, con un clic,
 *     llama `POST /api/chat/propuestas/:id/aprobacion`, que emite un token de un solo uso.
 *  3. `registrar_pago` exige ese token. El modelo de lenguaje nunca lo ve: no está en la
 *     conversación y la herramienta ni siquiera se le ofrece al modelo.
 *
 * El token es un HMAC con un secreto aleatorio del proceso; sobrevive solo mientras el
 * servidor está encendido, lo cual basta para una aprobación en vivo.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ErrorNegocio, type CuotaExigible } from '../persistencia/adaptador-nucleo.js';
import type { AplicacionPago } from '../dominio/prelacion-pago.js';
import type { Dinero } from '../dominio/dinero.js';

export type EstadoPropuesta = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'EJECUTADA';

export interface PropuestaPago {
  id: string;
  idCredito: string;
  monto: Dinero;
  fechaPago: string;
  canal: 'agencia' | 'campo' | 'transferencia';
  cuota: CuotaExigible;
  aplicacion: AplicacionPago;
  saldoCapitalResultante: Dinero;
  estado: EstadoPropuesta;
  aprobadoPor?: string;
}

export class ServicioAprobaciones {
  private readonly secreto = randomBytes(32);
  private readonly propuestas = new Map<string, PropuestaPago>();
  private readonly tokensUsados = new Set<string>();

  crear(datos: Omit<PropuestaPago, 'id' | 'estado'>): PropuestaPago {
    const propuesta: PropuestaPago = { ...datos, id: `PROP-${randomUUID()}`, estado: 'PENDIENTE' };
    this.propuestas.set(propuesta.id, propuesta);
    return propuesta;
  }

  obtener(id: string): PropuestaPago {
    const p = this.propuestas.get(id);
    if (!p) throw new ErrorNegocio('ENTIDAD_INEXISTENTE', `Propuesta no encontrada: ${id}`);
    return p;
  }

  /** Solo la invoca la API cuando una persona pulsa «Aprobar» en la interfaz. */
  aprobar(id: string, aprobadoPor: string): { propuesta: PropuestaPago; token: string } {
    const p = this.obtener(id);
    if (p.estado !== 'PENDIENTE') throw new ErrorNegocio('TRANSICION_INVALIDA', `La propuesta ${id} ya está ${p.estado}`);
    if (!aprobadoPor.trim()) throw new ErrorNegocio('DATOS_INVALIDOS', 'La aprobación requiere el nombre de quien aprueba');
    p.estado = 'APROBADA';
    p.aprobadoPor = aprobadoPor.trim();
    return { propuesta: p, token: this.firmar(id, p.aprobadoPor) };
  }

  rechazar(id: string): PropuestaPago {
    const p = this.obtener(id);
    if (p.estado !== 'PENDIENTE') throw new ErrorNegocio('TRANSICION_INVALIDA', `La propuesta ${id} ya está ${p.estado}`);
    p.estado = 'RECHAZADA';
    return p;
  }

  /** Verifica y consume el token. Lanza APROBACION_REQUERIDA si falta o no es válido. */
  consumir(id: string, token: string | undefined): PropuestaPago {
    const p = this.obtener(id);
    if (!token || p.estado !== 'APROBADA' || !p.aprobadoPor) {
      throw new ErrorNegocio('APROBACION_REQUERIDA', 'Registrar un pago exige la aprobación explícita de una persona en la interfaz', { propuestaId: id });
    }
    const esperado = Buffer.from(this.firmar(id, p.aprobadoPor), 'hex');
    const recibido = Buffer.from(token, 'hex');
    if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido) || this.tokensUsados.has(token)) {
      throw new ErrorNegocio('APROBACION_REQUERIDA', 'Token de aprobación inválido o ya utilizado', { propuestaId: id });
    }
    this.tokensUsados.add(token);
    return p;
  }

  marcarEjecutada(id: string): void {
    this.obtener(id).estado = 'EJECUTADA';
  }

  private firmar(id: string, aprobadoPor: string): string {
    return createHmac('sha256', this.secreto).update(`${id}|${aprobadoPor}`).digest('hex');
  }
}
