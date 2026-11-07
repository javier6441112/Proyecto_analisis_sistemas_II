import { beforeEach, expect, it, vi } from 'vitest';
import type { TRespuestaChat } from '../api';

// sessionStorage mínimo (las pruebas corren en Node, sin DOM).
const almacen = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => { almacen.set(k, v); },
  removeItem: (k: string) => { almacen.delete(k); },
});

const respuesta = (texto: string): TRespuestaChat => ({
  sesionId: '11111111-1111-4111-8111-111111111111', respuesta: texto, tarjetas: [], citas: [], propuestas: [], alertasSeguridad: [], control: {},
});

/** Simula recargar la página: módulos nuevos, el estado en memoria se pierde (sessionStorage no). */
async function modulo() {
  vi.resetModules();
  const { api } = await import('../api');
  const { conversacion } = await import('./conversacion');
  return { api, conversacion };
}

beforeEach(() => { almacen.clear(); vi.restoreAllMocks(); });

it('la respuesta se agrega al historial aunque nadie esté mirando la pantalla', async () => {
  const { api, conversacion } = await modulo();
  conversacion.abrir('emorales');
  let responder!: (r: TRespuestaChat) => void;
  vi.spyOn(api, 'chat').mockReturnValue(new Promise((ok) => { responder = ok; }));
  const envio = conversacion.enviar('¿Cuál es la cartera en riesgo?', '2026-10-31');
  expect(conversacion.instantanea()).toMatchObject({ pensando: true, mensajes: [{ de: 'persona' }] });
  // (la pestaña Asistente está desmontada mientras tanto: no hay suscriptores)
  responder(respuesta('La cartera en riesgo es 11.93 %.'));
  await envio;
  expect(conversacion.instantanea()).toMatchObject({ pensando: false, mensajes: [{ de: 'persona' }, { de: 'asistente' }] });
});

it('se conserva al recargar, con el borrador y las decisiones, pero sin quedar «pensando»', async () => {
  const a = await modulo();
  a.conversacion.abrir('emorales');
  vi.spyOn(a.api, 'chat').mockResolvedValue(respuesta('Hay 4 créditos en Mora 2.'));
  await a.conversacion.enviar('¿Qué créditos están en Mora 2?', '2026-10-31');
  a.conversacion.escribir('Y en Mora 3');
  a.conversacion.decidir('prop-1', 'aprobada');

  const b = await modulo();
  b.conversacion.abrir('emorales');
  expect(b.conversacion.instantanea()).toMatchObject({
    borrador: 'Y en Mora 3', pensando: false, sesionId: respuesta('').sesionId, decisiones: { 'prop-1': 'aprobada' },
  });
  expect(b.conversacion.instantanea().mensajes).toHaveLength(2);
});

it('cada cuenta tiene su conversación y cerrar sesión la borra', async () => {
  const { api, conversacion } = await modulo();
  conversacion.abrir('emorales');
  conversacion.escribir('borrador de Elena');
  conversacion.abrir('gerente');
  expect(conversacion.instantanea().borrador).toBe('');
  conversacion.abrir('emorales');
  expect(conversacion.instantanea().borrador).toBe('borrador de Elena');

  const olvidar = vi.spyOn(api, 'olvidarChat').mockResolvedValue(undefined);
  vi.spyOn(api, 'chat').mockResolvedValue(respuesta('ok'));
  await conversacion.enviar('hola', '2026-10-31');
  conversacion.descartar();
  expect(olvidar).toHaveBeenCalledWith(respuesta('').sesionId);
  expect(almacen.has('cv-chat:emorales')).toBe(false);
  expect(conversacion.instantanea().mensajes).toEqual([]);
});

it('una respuesta de una conversación ya descartada no se mezcla con la nueva', async () => {
  const { api, conversacion } = await modulo();
  conversacion.abrir('emorales');
  let responder!: (r: TRespuestaChat) => void;
  vi.spyOn(api, 'chat').mockReturnValue(new Promise((ok) => { responder = ok; }));
  vi.spyOn(api, 'olvidarChat').mockResolvedValue(undefined);
  const envio = conversacion.enviar('pregunta vieja', '2026-10-31');
  conversacion.nueva();
  responder(respuesta('respuesta vieja'));
  await envio;
  expect(conversacion.instantanea()).toMatchObject({ mensajes: [], pensando: false });
});
