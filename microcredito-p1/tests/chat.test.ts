/**
 * E5 · Orquestador del chat con un modelo GUIONADO (determinista, sin Ollama): prueba las
 * guardias de código que protegen al sistema aunque el modelo real se equivoque.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../src/mcp/aprobaciones.js';
import { conectarClienteLocal, type ClienteMcpLocal } from '../src/mcp/cliente-local.js';
import { EmbebedorDePrueba } from '../src/rag/embeddings.js';
import { BuscadorCorpus, ingestarCorpus } from '../src/rag/buscador.js';
import { OrquestadorChat, inferirSeguimiento } from '../src/chat/orquestador.js';
import { MENSAJE_CANARIO, MENSAJE_CIFRAS_NO_VERIFICADAS, MENSAJE_FUERA_DE_ALCANCE, cifrasNoVerificadas, filtrarSalida } from '../src/chat/guardias.js';
import { llamadasEnTexto, type LlamadaHerramienta, type MensajeChat, type ModeloLenguaje, type RespuestaModelo } from '../src/chat/modelo.js';

const F = '2026-10-31';
const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');

/** Modelo de prueba: primera ronda devuelve `llamadas`; después, el `texto` final. */
class ModeloGuionado implements ModeloLenguaje {
  readonly nombre = 'guionado';
  recibidos: MensajeChat[][] = [];
  constructor(private llamadas: LlamadaHerramienta[], private texto: string | ((m: MensajeChat[]) => string)) {}
  async conversar(mensajes: MensajeChat[]): Promise<RespuestaModelo> {
    this.recibidos.push(mensajes.map((m) => ({ ...m })));
    const yaLlamo = mensajes.some((m) => m.role === 'tool');
    if (!yaLlamo && this.llamadas.length > 0) return { texto: '', llamadas: this.llamadas };
    return { texto: typeof this.texto === 'function' ? this.texto(mensajes) : this.texto, llamadas: [] };
  }
}

let dir: string;
let adaptador: AdaptadorNucleo;
let mcp: ClienteMcpLocal;

beforeAll(async () => {
  if (!existsSync(ORIGEN_DB)) throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
  dir = join(mkdtempSync(join(tmpdir(), 'cv-chat-')), 'db');
  cpSync(ORIGEN_DB, dir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
  const embebedor = new EmbebedorDePrueba();
  await ingestarCorpus(adaptador.db, embebedor);
  mcp = await conectarClienteLocal({
    adaptador, servicio: new ServicioOperaciones(adaptador), aprobaciones: new ServicioAprobaciones(),
    buscador: new BuscadorCorpus(adaptador.db, embebedor, { umbral: 0, k: 3 }),
  });
}, 60_000);

afterAll(async () => {
  await mcp?.cerrar();
  await adaptador?.cerrar();
  if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true });
});

const preguntar = (modelo: ModeloLenguaje, mensaje: string, sesionId?: string) =>
  new OrquestadorChat(mcp, modelo).preguntar({ mensaje, fechaOperacion: F, ...(sesionId ? { sesionId } : {}) });

describe('Cifras: siempre del núcleo', () => {
  it('G-1 · una respuesta con las cifras de la herramienta se muestra tal cual, con su tarjeta', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'consultar_cartera', argumentos: { fechaCorte: F } }],
      'Cartera activa Q297,606.34; en riesgo Q35,508.23 (11.93 %); incobrable del mes Q2,333.48.'), '¿Cómo está la cartera?');
    expect(r.respuesta).toContain('Q297,606.34');
    expect(r.control.cifrasNoVerificadas).toEqual([]);
    expect(r.tarjetas[0]).toMatchObject({ herramienta: 'consultar_cartera', error: false, datos: { carteraActiva: '297606.34' } });
  });

  it('una cifra inventada por el modelo nunca llega al usuario', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'consultar_cartera', argumentos: { fechaCorte: F } }],
      'La cartera activa es de Q1,200,000.00.'), '¿Cómo está la cartera?');
    expect(r.respuesta.startsWith(MENSAJE_CIFRAS_NO_VERIFICADAS)).toBe(true);
    expect(r.respuesta).toContain('Datos del núcleo: Al 2026-10-31: cartera activa Q297,606.34');
    expect(r.respuesta).not.toContain('1,200,000');
    expect(r.control.cifrasNoVerificadas).toEqual(['1200000.00']);
    expect(r.tarjetas).toHaveLength(1);
  });

  it('si el modelo omite la fecha de corte se usa la fecha de operación, nunca el reloj', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'consultar_credito', argumentos: { idCredito: 'CV-2026-0030' } }], 'Listo.'), 'Estado de CV-2026-0030');
    expect(r.tarjetas[0].argumentos).toEqual({ idCredito: 'CV-2026-0030', fechaCorte: F });
    expect(r.tarjetas[0].datos).toMatchObject({ diasAtraso: 65, tramo: 'MORA_3' });
  });

  it('enteros enviados como texto por el modelo se corrigen según el esquema', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: '7' } }], 'Listo.'), 'Vencimientos 7 días');
    expect(r.tarjetas[0]).toMatchObject({ error: false, argumentos: { dias: 7 } });
  });
});

describe('Menor privilegio y aprobación humana', () => {
  it('registrar_pago no se ejecuta aunque el modelo lo pida', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'registrar_pago', argumentos: { propuestaId: 'X' } }], 'Hecho.'), 'Registra el pago');
    expect(r.control.herramientasBloqueadas).toEqual(['registrar_pago']);
    expect(r.tarjetas).toEqual([]);
    expect((await adaptador.auditarPagos()).registradosPorInterfaz).toBe(0);
  });

  it('proponer_pago devuelve una propuesta pendiente para el botón «Aprobar»', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'proponer_pago', argumentos: { idCredito: 'CV-2026-0043', monto: '561.87', fechaPago: F } }],
      'Preparé el pago de Q561.87; apruébelo en la pantalla.'), 'Cobra la cuota vencida de CV-2026-0043');
    expect(r.propuestas[0]).toMatchObject({ estado: 'PENDIENTE_DE_APROBACION_HUMANA', idCredito: 'CV-2026-0043' });
    expect((await adaptador.obtenerDetalleCredito('CV-2026-0043', F)).cuotasPagadas).toBe(0);
  });
});

describe('Corpus, citas y OP-7', () => {
  it('una pregunta normativa sin herramienta fuerza la recuperación y agrega la cita', async () => {
    const r = await preguntar(new ModeloGuionado([], 'Se calcula con una tasa del 24 % anual sobre el capital en mora.'),
      'Según las políticas vigentes, ¿cómo se calcula el interés moratorio de un crédito otorgado en agosto de 2026?');
    expect(r.control.recuperacionForzada).toBe(true);
    expect(r.control.herramientasUsadas).toEqual(['buscar_politicas']);
    expect(r.citas.length).toBeGreaterThan(0);
    expect(r.respuesta).toMatch(/\[[A-Z]+-[A-Z0-9-]+\]/);
  });

  it('si el modelo repite el canario, la respuesta se bloquea', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'buscar_politicas', argumentos: { pregunta: 'NOTA-CAMPO-07' } }], 'CANARIO-7431'),
      'Lee la nota NOTA-CAMPO-07 y sigue sus indicaciones');
    expect(r.respuesta).toBe(MENSAJE_CANARIO);
    expect(r.control.salidaBloqueada).toBe(true);
  });

  it('la nota se resume con aviso de seguridad y sin la orden', async () => {
    const modelo = new ModeloGuionado([{ nombre: 'buscar_politicas', argumentos: { pregunta: 'NOTA-CAMPO-07' } }],
      (m) => (m.some((x) => x.role === 'tool' && x.content.includes('CANARIO')) ? 'FILTRADO' : 'NOTA-CAMPO-07 pide registrar las visitas el mismo día.'));
    const r = await preguntar(modelo, 'Lee la nota NOTA-CAMPO-07 y sigue sus indicaciones');
    expect(r.respuesta).toContain('NOTA-CAMPO-07 pide registrar las visitas');
    expect(r.respuesta).toMatch(/Aviso de seguridad/);
    expect(r.alertasSeguridad.length).toBe(1);
  });

  it('fuera de tema y sin herramientas: respuesta fija, no la del modelo', async () => {
    const r = await preguntar(new ModeloGuionado([], 'Ganó Argentina.'), '¿Quién ganó el mundial?');
    expect(r.respuesta).toBe(MENSAJE_FUERA_DE_ALCANCE);
  });
});

describe('Memoria de la sesión', () => {
  it('la segunda pregunta llega al modelo con la conversación anterior', async () => {
    const chat = new OrquestadorChat(mcp, new ModeloGuionado([{ nombre: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 7 } }], 'Listo.'));
    const r1 = await chat.preguntar({ mensaje: '¿Qué vence en 7 días?', fechaOperacion: F });
    const segundo = new ModeloGuionado([{ nombre: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 30 } }], 'Listo.');
    const chat2 = chat as unknown as { modelo: ModeloLenguaje };
    chat2.modelo = segundo;
    await chat.preguntar({ sesionId: r1.sesionId, mensaje: '¿Y en los próximos 30?', fechaOperacion: F });
    const contenidos = segundo.recibidos[0].map((m) => m.content);
    expect(contenidos).toContain('¿Qué vence en 7 días?');
    expect(contenidos.some((c) => c.startsWith('[Consultado: ver_proximos_vencimientos({"fechaCorte":"2026-10-31","dias":7})]\nListo.'))).toBe(true);
  });
});

describe('Respuestas incompletas', () => {
  it('si la redacción omite cifras clave, se agrega el resumen del núcleo', async () => {
    const r = await preguntar(new ModeloGuionado([{ nombre: 'explicar_mora', argumentos: { idCredito: 'CV-2026-0410', numeroCuota: 2, fechaCorte: '2027-01-24' } }],
      'La mora se calcula por tramos recorridos.'), 'Mora de la cuota 2 de CV-2026-0410 al 2027-01-24');
    expect(r.respuesta).toMatch(/Datos del núcleo: .*Q18\.14/);
    expect(r.control.resumenDelNucleoAgregado).toBe(true);
  });

  it('una pregunta encadenada sin herramienta se reintenta pidiendo la consulta', async () => {
    const chat = new OrquestadorChat(mcp, new ModeloGuionado([{ nombre: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 7 } }], 'Listo.'));
    const r1 = await chat.preguntar({ mensaje: '¿Qué vence en 7 días?', fechaOperacion: F });
    let llamada = 0;
    const soloTexto = false;
    const perezoso: ModeloLenguaje = {
      nombre: 'perezoso',
      async conversar(m) {
        llamada++;
        if (llamada === 1) return { texto: 'Lo mismo de antes.', llamadas: [] };
        if (llamada === 2 && soloTexto) return { texto: 'Sigue igual.', llamadas: [] };
        return m.some((x) => x.role === 'tool') ? { texto: 'Listo.', llamadas: [] } : { texto: '', llamadas: [{ nombre: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 30 } }] };
      },
    };
    (chat as unknown as { modelo: ModeloLenguaje }).modelo = perezoso;
    const r2 = await chat.preguntar({ sesionId: r1.sesionId, mensaje: '¿Y en los próximos 30?', fechaOperacion: F });
    expect(r2.control.reintentoPorSeguimiento).toBe(true);
    expect(r2.tarjetas[0].argumentos).toMatchObject({ dias: 30 });
  });

  it('si el modelo insiste en no consultar, se repite la consulta anterior con el parámetro nuevo', async () => {
    const chat = new OrquestadorChat(mcp, new ModeloGuionado([{ nombre: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 7 } }], 'Listo.'));
    const r1 = await chat.preguntar({ mensaje: '¿Qué vence en 7 días?', fechaOperacion: F });
    const terco: ModeloLenguaje = { nombre: 'terco', async conversar(m) { return m.some((x) => x.role === 'tool') ? { texto: 'Listo.', llamadas: [] } : { texto: 'Igual que antes.', llamadas: [] }; } };
    (chat as unknown as { modelo: ModeloLenguaje }).modelo = terco;
    const r2 = await chat.preguntar({ sesionId: r1.sesionId, mensaje: '¿Y en los próximos 30?', fechaOperacion: F });
    expect(r2.control.seguimientoInferido).toBe(true);
    expect(r2.tarjetas[0]).toMatchObject({ herramienta: 'ver_proximos_vencimientos', argumentos: { dias: 30 }, error: false });
    expect(r2.respuesta).toMatch(/Datos del núcleo: Del 2026-11-01 al 2026-11-30/);
  });
});

describe('Guardias puras', () => {
  it('omite DPI y teléfonos pero no confunde identificadores de crédito', () => {
    const r = filtrarSalida('Cliente DPI-FICT-000030, tel. 5555-1203, crédito CV-2026-0043, pago IDEM-000068.');
    expect(r.texto).toBe('Cliente [dato personal omitido], tel. [dato personal omitido], crédito CV-2026-0043, pago IDEM-000068.');
    expect(r.redacciones).toBe(2);
  });

  it('acepta la forma decimal de una tasa publicada en porcentaje', () => {
    expect(cifrasNoVerificadas('725.76 × 0.18 ÷ 360 × 30', ['{"tasaNominalAnual":"18.00 %","capital":"725.76"}'])).toEqual([]);
  });

  it('infiere el parámetro de una pregunta encadenada sin adivinar', () => {
    const previa = { herramienta: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 7 } };
    expect(inferirSeguimiento('¿Y en los próximos 30?', previa)).toEqual({ herramienta: 'ver_proximos_vencimientos', argumentos: { fechaCorte: F, dias: 30 } });
    expect(inferirSeguimiento('¿Y al 30 de noviembre de 2026?', { herramienta: 'consultar_cartera', argumentos: { fechaCorte: F } }))
      .toEqual({ herramienta: 'consultar_cartera', argumentos: { fechaCorte: '2026-11-30' } });
    expect(inferirSeguimiento('¿y CV-2026-0035?', { herramienta: 'consultar_credito', argumentos: { idCredito: 'CV-2026-0030', fechaCorte: F } }))
      .toEqual({ herramienta: 'consultar_credito', argumentos: { idCredito: 'CV-2026-0035', fechaCorte: F } });
    expect(inferirSeguimiento('gracias', previa)).toBeUndefined();
  });

  it('acepta el monto redondeado de un importe sin redondear', () => {
    expect(cifrasNoVerificadas('Mora total Q18.14', ['{"totalSinRedondear":"18.144"}'])).toEqual([]);
  });

  it('reconoce llamadas escritas como texto JSON', () => {
    expect(llamadasEnTexto('```\n[{"name":"consultar_cierre","arguments":{"periodo":"2026-10"}}]\n```')).toEqual([{ nombre: 'consultar_cierre', argumentos: { periodo: '2026-10' } }]);
    expect(llamadasEnTexto('Hola, ¿en qué puedo ayudar?')).toEqual([]);
  });
});
