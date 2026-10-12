/**
 * API REST (E1): expone los puertos primarios del P1 a la interfaz React.
 *
 * - Toda lectura exige `fechaCorte` explícita; la API nunca lee el reloj.
 * - Las cifras salen del adaptador → núcleo; aquí solo se valida y serializa.
 * - Registrar un pago exige `Idempotency-Key` y `aprobacion.aprobado = true`.
 * - Perfiles mínimos (enunciado 3.1): cabecera `X-Perfil: asesor | gerencia` y
 *   `X-Usuario`. Resolver solicitudes (comité) es solo de gerencia.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AdaptadorNucleo, ErrorNegocio } from '../persistencia/adaptador-nucleo.js';
import { CANALES, ServicioOperaciones } from '../persistencia/servicio-operaciones.js';
import type { TramoMora } from '../dominio/politica-mora/politica-mora.js';
import { aJson } from './serializacion.js';
import { aProblema } from './errores.js';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');
const Monto = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Monto con hasta dos decimales, como texto');
const Tramo = z.enum(['MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO', 'INCOBRABLE']);
const Perfil = z.enum(['asesor', 'gerencia']);

const ConCorte = z.object({ fechaCorte: Fecha });

const AltaClienteBody = z.object({
  idCliente: z.string().regex(/^CL-\d{4}$/),
  nombreCompleto: z.string().trim().min(3).max(150),
  dpi: z.string().trim().min(5).max(30),
  telefono: z.string().trim().max(20).optional(),
  municipio: z.string().trim().min(2).max(100),
  fechaAlta: Fecha,
}).strict();

const SolicitudBody = z.object({
  idSolicitud: z.string().regex(/^SOL-\d{4,8}$/).optional(),
  idCliente: z.string().regex(/^CL-\d{4}$/),
  idAsesor: z.string().regex(/^AS-\d{2}$/),
  capital: Monto,
  plazoMeses: z.number().int().min(3).max(24),
  tnaBps: z.number().int().min(1).max(9999),
  fecha: Fecha,
}).strict();

const PlanBody = z.object({
  capital: Monto,
  plazoMeses: z.number().int().min(3).max(24),
  tnaBps: z.number().int().min(1).max(9999),
  fechaDesembolso: Fecha,
}).strict();

const ResolucionBody = z.object({
  decision: z.enum(['APROBADA', 'RECHAZADA']),
  motivo: z.string().trim().min(3).max(300),
  fecha: Fecha,
}).strict();

const DesembolsoBody = z.object({ idCredito: z.string().regex(/^CV-\d{4}-\d{4}$/), fecha: Fecha }).strict();

const SimulacionPagoBody = z.object({
  idCredito: z.string().min(1),
  fechaPago: Fecha,
  monto: Monto.optional(),
  claveIdempotencia: z.string().min(1).max(64).optional(),
}).strict();

const PagoBody = z.object({
  monto: Monto,
  fechaPago: Fecha,
  canal: z.enum(CANALES),
  aprobacion: z.object({ aprobado: z.boolean(), aprobadoPor: z.string().trim().min(1) }).strict().optional(),
}).strict();

export interface OpcionesServidor {
  adaptador: AdaptadorNucleo;
  servicio?: ServicioOperaciones;
  registrar?: (app: FastifyInstance) => Promise<void> | void;
  logger?: boolean;
}

function quien(req: FastifyRequest): { perfil: z.infer<typeof Perfil>; usuario: string } {
  const perfil = Perfil.safeParse(req.headers['x-perfil']);
  const usuario = String(req.headers['x-usuario'] ?? '').trim();
  if (!perfil.success || !usuario) {
    throw new ErrorNegocio('DATOS_INVALIDOS', 'Las operaciones requieren las cabeceras X-Perfil (asesor|gerencia) y X-Usuario');
  }
  return { perfil: perfil.data, usuario };
}

function soloGerencia(req: FastifyRequest): string {
  const q = quien(req);
  if (q.perfil !== 'gerencia') throw Object.assign(new Error('Solo el perfil gerencia puede resolver solicitudes'), { statusCode: 403 });
  return q.usuario;
}

export async function construirServidor(opciones: OpcionesServidor): Promise<FastifyInstance> {
  const { adaptador } = opciones;
  const servicio = opciones.servicio ?? new ServicioOperaciones(adaptador);
  const app = Fastify({ logger: opciones.logger ?? false });

  app.setErrorHandler((error, _req, reply: FastifyReply) => {
    const problema = aProblema(error);
    if (problema.status >= 500) app.log.error(error);
    void reply.status(problema.status).type('application/problem+json').send(problema);
  });
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).type('application/problem+json').send({
      type: 'https://creditovecino.local/problemas/ruta-inexistente', title: 'Ruta inexistente', status: 404, detail: `${req.method} ${req.url}`, codigo: 'ENTIDAD_INEXISTENTE',
    });
  });

  const ok = (reply: FastifyReply, cuerpo: unknown, status = 200) => reply.status(status).send(aJson(cuerpo));

  // ---------------- Catálogos ----------------
  app.get('/api/salud', async (_req, reply) => ok(reply, { estado: 'ok', pagos: await adaptador.auditarPagos() }));
  app.get('/api/asesores', async (_req, reply) => ok(reply, await adaptador.listarAsesores()));
  app.get('/api/politicas', async (_req, reply) => ok(reply, adaptador.politicas.parametros));

  app.get('/api/clientes', async (req, reply) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const texto = q?.trim().toLowerCase();
    const clientes = (await adaptador.listarClientes()).filter((c) =>
      !texto || c.idCliente.toLowerCase().includes(texto) || c.nombreCompleto.toLowerCase().includes(texto) || c.dpi.toLowerCase().includes(texto));
    return ok(reply, clientes);
  });
  app.post('/api/clientes', async (req, reply) => {
    const { usuario } = quien(req);
    return ok(reply, await servicio.registrarCliente(AltaClienteBody.parse(req.body), usuario), 201);
  });

  // ---------------- Créditos ----------------
  app.get('/api/creditos', async (req, reply) => {
    const { fechaCorte, q, idAsesor } = ConCorte.extend({ q: z.string().optional(), idAsesor: z.string().optional() }).parse(req.query);
    const texto = q?.trim().toLowerCase();
    const filas = (await adaptador.listarDetallesCreditos(fechaCorte))
      .filter((d) => !idAsesor || d.idAsesor === idAsesor)
      .filter((d) => !texto || d.idCredito.toLowerCase().includes(texto) || d.nombreCliente.toLowerCase().includes(texto) || d.idCliente.toLowerCase().includes(texto))
      .map((d) => ({
        idCredito: d.idCredito, idCliente: d.idCliente, nombreCliente: d.nombreCliente, idAsesor: d.idAsesor,
        fechaDesembolso: d.fechaDesembolso, capitalOriginal: d.capitalOriginal, saldoCapital: d.saldoCapital,
        estado: d.estado, diasAtraso: d.diasAtraso, tramo: d.tramo, politicaMora: d.politicaMora, proximaCuota: d.proximaCuota,
      }));
    return ok(reply, { fechaCorte, creditos: filas });
  });

  app.get('/api/creditos/:idCredito', async (req, reply) => {
    const { idCredito } = z.object({ idCredito: z.string() }).parse(req.params);
    const { fechaCorte } = ConCorte.parse(req.query);
    return ok(reply, await adaptador.obtenerDetalleCredito(idCredito, fechaCorte));
  });

  app.get('/api/creditos/:idCredito/plan', async (req, reply) => {
    const { idCredito } = z.object({ idCredito: z.string() }).parse(req.params);
    const { fechaCorte } = ConCorte.parse(req.query);
    const d = await adaptador.obtenerDetalleCredito(idCredito, fechaCorte);
    const plan = adaptador.simularPlan(d.capitalOriginal, d.plazoMeses, d.tnaBps, d.fechaDesembolso);
    const vencidas = new Set(d.cuotasVencidas.map((c) => c.numero));
    const cuotas = plan.cuotas.map((c) => {
      const pago = d.pagos.find((p) => p.numeroCuota === c.numero);
      return { ...c, estado: pago ? 'PAGADA' : vencidas.has(c.numero) ? 'VENCIDA' : 'PENDIENTE', ...(pago ? { fechaPago: pago.fecha } : {}) };
    });
    return ok(reply, { idCredito, fechaCorte, estadoCredito: d.estado, ...plan, cuotas });
  });

  app.get('/api/creditos/:idCredito/cuotas/:numero/mora', async (req, reply) => {
    const { idCredito, numero } = z.object({ idCredito: z.string(), numero: z.coerce.number().int().min(1) }).parse(req.params);
    const { fechaCorte } = ConCorte.parse(req.query);
    return ok(reply, await adaptador.explicarMora(idCredito, numero, fechaCorte));
  });

  // ---------------- Gerencia ----------------
  app.get('/api/cartera', async (req, reply) => {
    const { fechaCorte } = ConCorte.parse(req.query);
    const c = await adaptador.resumirCarteraTotal(fechaCorte);
    // Porcentajes ya formateados en el servidor: la interfaz no hace ninguna operación.
    const pct = (d: { times(n: number): { toFixed(n: number): string } }): string => `${d.times(100).toFixed(2)} %`;
    return ok(reply, {
      ...c,
      porcentajes: {
        mora: pct(c.porcentajeMora),
        riesgo: pct(c.resumen.porcentajeRiesgo),
        riesgoPorTramo: Object.fromEntries(c.resumen.riesgoPorTramo.map((t) => [t.tramo, pct(t.porcentajeCarteraActiva)])),
      },
    });
  });
  app.get('/api/cartera/mora', async (req, reply) => {
    const { fechaCorte, tramo } = ConCorte.extend({ tramo: Tramo.optional() }).parse(req.query);
    return ok(reply, await adaptador.listarCreditosEnMora(fechaCorte, tramo as TramoMora | undefined));
  });
  app.get('/api/vencimientos', async (req, reply) => {
    const { fechaCorte, dias } = ConCorte.extend({ dias: z.coerce.number().int().min(1).max(366) }).parse(req.query);
    return ok(reply, await adaptador.verProximosVencimientos(fechaCorte, dias));
  });
  app.get('/api/cierres/:periodo', async (req, reply) => {
    const { periodo } = z.object({ periodo: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Periodo AAAA-MM o AAAA-MM-DD') }).parse(req.params);
    return ok(reply, await adaptador.consultarCierre(periodo));
  });

  // ---------------- Originación (OP-3) ----------------
  app.post('/api/simulaciones/plan', async (req, reply) => {
    const b = PlanBody.parse(req.body);
    return ok(reply, adaptador.simularPlan(b.capital, b.plazoMeses, b.tnaBps, b.fechaDesembolso));
  });
  app.get('/api/solicitudes', async (_req, reply) => ok(reply, await servicio.listarSolicitudes()));
  app.post('/api/solicitudes', async (req, reply) => {
    const { usuario } = quien(req);
    return ok(reply, await servicio.crearSolicitud(SolicitudBody.parse(req.body), usuario), 201);
  });
  app.post('/api/solicitudes/:idSolicitud/resolucion', async (req, reply) => {
    const usuario = soloGerencia(req);
    const { idSolicitud } = z.object({ idSolicitud: z.string() }).parse(req.params);
    return ok(reply, await servicio.resolverSolicitud(idSolicitud, ResolucionBody.parse(req.body), usuario));
  });
  app.post('/api/solicitudes/:idSolicitud/desembolso', async (req, reply) => {
    const { usuario } = quien(req);
    const { idSolicitud } = z.object({ idSolicitud: z.string() }).parse(req.params);
    return ok(reply, await servicio.desembolsar(idSolicitud, DesembolsoBody.parse(req.body), usuario), 201);
  });

  // ---------------- Pagos (OP-1, 2, 4, 5, 6) ----------------
  app.post('/api/pagos/simulacion', async (req, reply) => {
    const b = SimulacionPagoBody.parse(req.body);
    if (!b.monto) return ok(reply, await adaptador.consultarExigible(b.idCredito, b.fechaPago));
    return ok(reply, await adaptador.simularLiquidacionPago({
      idCredito: b.idCredito, monto: b.monto, fechaPago: b.fechaPago, ...(b.claveIdempotencia ? { claveIdempotencia: b.claveIdempotencia } : {}),
    }));
  });

  app.post('/api/creditos/:idCredito/pagos', async (req, reply) => {
    const { usuario } = quien(req);
    const { idCredito } = z.object({ idCredito: z.string() }).parse(req.params);
    const clave = z.string().trim().min(1, 'La cabecera Idempotency-Key es obligatoria').max(64).parse(req.headers['idempotency-key'] ?? '');
    const b = PagoBody.parse(req.body);
    const resultado = await servicio.registrarPago({
      idCredito, monto: b.monto, fechaPago: b.fechaPago, canal: b.canal, claveIdempotencia: clave, usuario,
      ...(b.aprobacion ? { aprobacion: b.aprobacion } : {}),
    });
    return ok(reply, resultado, resultado.resultado === 'APLICADO' ? 201 : 200);
  });

  if (opciones.registrar) await opciones.registrar(app);
  return app;
}
