import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptadorNucleo } from '../../../src/persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../../../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../../../src/mcp/aprobaciones.js';
import { conectarClienteLocal, type ClienteMcpLocal } from '../../../src/mcp/cliente-local.js';
import { PropuestaPagoChat, type TPropuestaPagoChat } from '../../../src/contratos/api.js';
import { api } from '../api';
import { PropuestaPago, Respuesta } from './Asistente';
import { OrquestadorChat } from '../../../src/chat/orquestador.js';

// Estado controlado para inspeccionar los botones reales sin agregar un DOM de pruebas.
const estado = vi.hoisted(() => ({ valores: [] as unknown[], indice: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (inicial: unknown) => {
    const i = estado.indice++;
    if (!(i in estado.valores)) estado.valores[i] = inicial;
    return [estado.valores[i], (valor: unknown) => { estado.valores[i] = valor; }];
  },
}));
vi.mock('../sesion', async (original) => ({
  ...await original<typeof import('../sesion')>(),
  useSesion: () => ({ usuario: 'Elena Morales', fecha: '2026-10-31', perfil: 'gerencia' }),
}));

let directorio: string;
let adaptador: AdaptadorNucleo;
let mcp: ClienteMcpLocal;
let propuesta: TPropuestaPagoChat;
beforeAll(async () => {
  directorio = mkdtempSync(join(tmpdir(), 'cv-propuesta-ui-'));
  const dbDir = join(directorio, 'db');
  cpSync(process.env.CV_DB_DIR ?? resolve('.cv-db'), dbDir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir });
  mcp = await conectarClienteLocal({ adaptador, servicio: new ServicioOperaciones(adaptador), aprobaciones: new ServicioAprobaciones() });
  const resultado = await mcp.llamar('proponer_pago', { idCredito: 'CV-2026-0043', fechaPago: '2026-10-31', canal: 'campo' });
  expect(resultado.isError).not.toBe(true);
  propuesta = PropuestaPagoChat.parse(resultado.structuredContent);
}, 60_000);
afterAll(async () => {
  await mcp?.cerrar();
  await adaptador?.cerrar();
  if (directorio) rmSync(directorio, { recursive: true, force: true });
});
beforeEach(() => { estado.valores = []; estado.indice = 0; vi.restoreAllMocks(); });

function tarjeta() {
  estado.indice = 0;
  return PropuestaPago({ datos: propuesta });
}
function botones(elemento: ReactElement): Array<ReactElement<{ onClick: () => void; children: unknown }>> {
  const props = elemento.props as { children?: unknown };
  const hijos = Array.isArray(props.children) ? props.children.flat(Infinity) : [props.children];
  return [
    ...(elemento.type === 'button' ? [elemento as ReactElement<{ onClick: () => void; children: unknown }>] : []),
    ...hijos.filter((h): h is ReactElement => !!h && typeof h === 'object' && 'props' in h).flatMap(botones),
  ];
}

it('renderiza la propuesta real del MCP y no registra al mostrarla', async () => {
  const aprobar = vi.spyOn(api, 'aprobarPropuesta');
  const html = renderToStaticMarkup(tarjeta());
  for (const texto of ['CV-2026-0043', '31 oct 2026', 'Q561.87', 'Q0.00', 'Q17.22', 'Q75.00', 'Q469.65', 'Q2,530.35', 'Rechazar', 'Aprobar como Elena Morales']) expect(html).toContain(texto);
  expect(aprobar).not.toHaveBeenCalled();
  expect((await adaptador.obtenerDetalleCredito(propuesta.idCredito, propuesta.fechaPago)).cuotasPagadas).toBe(0);
});

it('muestra Aprobar y el exigible real cuando el modelo intenta quedarse en políticas', async () => {
  const antes = await adaptador.leerEventosBitacora();
  const chat = new OrquestadorChat(mcp, { nombre: 'regresion-politicas', async conversar() {
    return { texto: 'El ejemplo documental exige Q1047.76.', llamadas: [{ nombre: 'buscar_politicas', argumentos: { pregunta: 'POL-2026-10' } }] };
  } });
  const r = await chat.preguntar({ mensaje: 'Genera una propuesta de pago para CV-2026-0043 al 2026-10-31', fechaOperacion: '2026-10-31' });
  const html = renderToStaticMarkup(createElement(Respuesta, { r }));
  expect(html).toContain('Q561.87');
  expect(html).toContain('Aprobar como Elena Morales');
  expect(html).not.toContain('1047.76');
  expect(await adaptador.leerEventosBitacora()).toEqual(antes);
});

it.each([true, false])('la decisión humana aprobar=%s utiliza propuestaId', async (aprobar) => {
  const aprobacion = vi.spyOn(api, 'aprobarPropuesta').mockResolvedValue({ resultado: 'APLICADO' });
  const rechazo = vi.spyOn(api, 'rechazarPropuesta').mockResolvedValue({} as never);
  botones(tarjeta())[aprobar ? 1 : 0].props.onClick();
  await vi.waitFor(() => expect(estado.valores[0]).toBe(aprobar ? 'aprobada' : 'rechazada'));
  expect(aprobar ? aprobacion : rechazo).toHaveBeenCalledTimes(1);
  expect(aprobar ? aprobacion : rechazo).toHaveBeenCalledWith(propuesta.propuestaId);
  expect(aprobar ? rechazo : aprobacion).not.toHaveBeenCalled();
});

it.each([true, false])('muestra errores al decidir aprobar=%s y conserva los botones pendientes', async (aprobar) => {
  vi.spyOn(api, aprobar ? 'aprobarPropuesta' : 'rechazarPropuesta').mockRejectedValue(new Error('No se pudo registrar el pago'));
  botones(tarjeta())[aprobar ? 1 : 0].props.onClick();
  await vi.waitFor(() => expect(estado.valores[1]).toBe('No se pudo registrar el pago'));
  expect(renderToStaticMarkup(tarjeta())).toContain('No se pudo registrar el pago');
  expect(botones(tarjeta())).toHaveLength(2);
});

it('muestra el error de proponer_pago en la respuesta del chat', () => {
  const html = renderToStaticMarkup(createElement(Respuesta, { r: {
    sesionId: 'prueba', respuesta: 'No se pudo proponer el pago', propuestas: [], citas: [], alertasSeguridad: [], control: {},
    tarjetas: [{ herramienta: 'proponer_pago', argumentos: {}, error: true, datos: { error: { codigo: 'MONTO_NO_EXACTO', mensaje: 'El monto debe ser exacto' } } }],
  } }));
  expect(html).toContain('El monto debe ser exacto');
});

it('las fuentes documentales no se presentan como tarjetas del núcleo financiero', () => {
  const html = renderToStaticMarkup(createElement(Respuesta, { r: {
    sesionId: 'documentos', respuesta: 'Política consultada.', propuestas: [], alertasSeguridad: [], control: {},
    citas: [{ docId: 'POL-2026-10', titulo: 'Mora escalonada', vigencia: 'Desde octubre' }],
    tarjetas: [{ herramienta: 'buscar_politicas', argumentos: {}, error: false, datos: { fragmentos: [] } }],
  } }));
  expect(html).toContain('Fuentes:');
  expect(html).not.toContain('Datos del núcleo');
  expect(html).not.toContain('Aprobar');
});
