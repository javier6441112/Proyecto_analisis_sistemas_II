import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Ayuda contextual (heurística 10 de Nielsen «ayuda y documentación»; ISO 9241-110, autodescripción).
 * Un mismo botón «?» aparece en todas las pantallas y abre la ayuda de la sección actual.
 * F1 también la abre; Esc la cierra. El contenido es texto fijo: no consulta la API ni calcula cifras.
 */

export type SeccionAyuda =
  | 'login' | 'inicio' | 'clientes' | 'solicitudes' | 'creditos' | 'pagos'
  | 'tablero' | 'comite' | 'cierres' | 'asistente';

interface Contenido {
  titulo: string;
  proposito: string;
  pasos: string[];
  preguntas: Array<[string, string]>;
  conceptos?: Array<keyof typeof GLOSARIO>;
}

const GLOSARIO = {
  fecha: ['Fecha de operación', 'Es la fecha de corte de todas las consultas. El sistema no usa el reloj de la computadora: si la cambia, todas las cifras se recalculan a ese día. Por defecto es el 31 de octubre de 2026.'],
  tramos: ['Tramos de mora', 'Al día (0 días) · Mora 1 (1 a 30 días) · Mora 2 (31 a 60) · Mora 3 (61 a 90) · Vencido (91 a 120) · Incobrable (más de 120 días; ya no acepta pagos). Un crédito reestructurado que va al día se muestra como «Reestructurado al día».'],
  riesgo: ['Cartera en riesgo', 'Saldo de capital de los créditos con más de 30 días de atraso, más los reestructurados aunque estén al día.'],
  prelacion: ['Prelación del pago', 'Todo pago se aplica en este orden: gastos de cobranza → interés moratorio → interés corriente → capital. Debe cubrir exactamente la cuota vencida más antigua.'],
  moraPlana: ['Mora plana (POL-2024-01)', 'Créditos otorgados hasta el 30/09/2026: 24 % nominal anual sobre el capital en mora, base Actual/360.'],
  moraEscalonada: ['Mora escalonada (POL-2026-10)', 'Créditos otorgados desde el 01/10/2026: la tasa sube según el tramo que la cuota va recorriendo (18 %, 24 %, 30 % y 36 % anual).'],
  gasto: ['Gasto de gestión de cobro', 'Q25.00 por cuota que llega a 31 días de atraso. Se cobra una sola vez y solo en créditos con política escalonada.'],
  idempotencia: ['Reintento seguro', 'Cada pago lleva una clave única. Si la conexión falla y lo reenvía, el sistema reconoce la clave y no cobra dos veces.'],
  aprobacion: ['Aprobación humana', 'El asistente puede preparar un pago, pero nunca lo registra solo: una persona debe revisarlo y aprobarlo.'],
} as const;

const AYUDA: Record<SeccionAyuda, Contenido> = {
  login: {
    titulo: 'Iniciar sesión',
    proposito: 'Elija si entra como asesor de crédito o como gerencia, seleccione su usuario y escriba su clave.',
    pasos: ['Elija «Asesor de crédito» o «Gerencia».', 'Seleccione su nombre en la lista.', 'Escriba su clave y presione «Iniciar sesión».'],
    preguntas: [
      ['Olvidé mi clave', 'Solicite a su supervisor o al administrador del sistema que la restablezca. Por seguridad, la clave no se puede recuperar desde esta pantalla.'],
      ['Dice que no se pudo contactar la API', 'El servidor no está encendido. En la computadora del sistema ejecute «npm run api» (o «.\\iniciar.ps1») y vuelva a intentarlo.'],
      ['¿Por qué queda mi nombre registrado?', 'Cada operación, aprobación y cierre guarda quién la hizo, para la auditoría.'],
    ],
  },
  inicio: {
    titulo: 'Inicio del asesor',
    proposito: 'Resumen de su cartera: créditos activos, créditos con atraso y próximos vencimientos, para decidir a quién visitar primero.',
    pasos: ['Revise el crédito con más días de atraso: es la primera visita sugerida.', 'Toque un crédito para ver su detalle o registrar un pago.', 'Use la barra inferior para ir a Clientes, Solicitudes, Créditos o Pagos.'],
    preguntas: [['Las cifras no coinciden con lo que esperaba', 'Revise la fecha de operación: todas las cifras se calculan a esa fecha.']],
    conceptos: ['fecha', 'tramos', 'riesgo'],
  },
  clientes: {
    titulo: 'Clientes',
    proposito: 'Buscar clientes y registrar clientes nuevos (UC-01).',
    pasos: ['Busque por nombre, DPI o código.', 'Para un cliente nuevo, complete los datos obligatorios y guarde.', 'Desde la ficha del cliente puede iniciar una solicitud de crédito.'],
    preguntas: [
      ['Dice que el cliente ya existe', 'Ya hay un cliente con ese DPI o código: búsquelo y use su ficha en lugar de crear otro.'],
      ['¿Quién ve los datos personales?', 'Solo el personal autorizado. El asistente de gerencia nunca muestra DPI ni teléfonos.'],
    ],
  },
  solicitudes: {
    titulo: 'Solicitudes de crédito',
    proposito: 'Preparar una solicitud con su plan de pagos simulado, enviarla al comité y, cuando esté aprobada, desembolsarla (UC-02 y UC-04).',
    pasos: [
      'Seleccione el cliente e ingrese monto, plazo y destino.',
      'Revise el plan de amortización simulado: muestra cada cuota con capital e interés.',
      'Envíe la solicitud al comité. Quedará «Pendiente» hasta que gerencia la resuelva.',
      'Cuando esté «Aprobada», confirme el desembolso: ahí nace el crédito.',
    ],
    preguntas: [
      ['¿El plan simulado es el definitivo?', 'Es el mismo cálculo; las fechas finales se fijan con la fecha real del desembolso.'],
      ['No puedo desembolsar', 'Solo se desembolsan solicitudes aprobadas por el comité.'],
    ],
  },
  creditos: {
    titulo: 'Créditos',
    proposito: 'Consultar el estado de un crédito, su plan de pagos y cómo se formó la mora de cada cuota (UC-06).',
    pasos: [
      'Busque el crédito por código (por ejemplo CV-2026-0030) o por cliente.',
      'En el detalle verá saldo, días de atraso, tramo y cuotas vencidas.',
      'Use «Ver plan de amortización» para ver todas las cuotas, o «Ver cómo se calculó la mora» para el detalle tramo por tramo.',
    ],
    preguntas: [
      ['¿Por qué la mora de dos cuotas es distinta?', 'Cada cuota vencida se calcula por separado, con sus propios días de atraso y sobre su propio capital.'],
      ['¿Qué política tiene mi crédito?', 'Depende de la fecha de otorgamiento: hasta el 30/09/2026 es plana; desde el 01/10/2026, escalonada.'],
    ],
    conceptos: ['tramos', 'moraPlana', 'moraEscalonada', 'gasto'],
  },
  pagos: {
    titulo: 'Registrar pago',
    proposito: 'Cobrar la cuota vencida más antigua de un crédito, con su desglose y aprobación (UC-05).',
    pasos: [
      'Busque el crédito: el monto exigible aparece ya calculado.',
            'Indique monto, fecha de recepción y canal, y toque «Revisar pago».',
      'Revise el desglose, marque la casilla de aprobación y toque «Confirmar pago».',
      'Muestre el comprobante al cliente.',
    ],
    preguntas: [
      ['Me rechaza el monto', 'El pago debe ser exacto: el mensaje indica el monto correcto de la cuota vencida más antigua.'],
      ['No sé si el pago quedó registrado', 'Use «Reenviar el mismo pago»: viaja con la misma clave y el sistema devuelve el pago original sin cobrar de nuevo.'],
      ['El crédito no acepta pagos', 'Está clasificado como incobrable (más de 120 días): se gestiona por otra vía.'],
    ],
    conceptos: ['prelacion', 'idempotencia', 'gasto'],
  },
  tablero: {
    titulo: 'Tablero gerencial',
    proposito: 'Estado de la cartera a la fecha de operación: cartera activa, en mora, en riesgo por tramo e incobrables del mes (UC-08).',
    pasos: ['Cambie la fecha de operación para ver la cartera a otro corte.', 'Abra un tramo para ver la lista de créditos que lo forman.', 'Use los accesos a Comité, Cierres o Asistente.'],
    preguntas: [['¿De dónde salen las cifras?', 'Todas las calcula el núcleo financiero; la pantalla solo las muestra, no hace cálculos.']],
    conceptos: ['fecha', 'tramos', 'riesgo'],
  },
  comite: {
    titulo: 'Bandeja del comité',
    proposito: 'Evaluar las solicitudes pendientes y aprobarlas o rechazarlas (UC-03).',
    pasos: ['Abra una solicitud para revisar cliente, monto, plazo y plan simulado.', 'Apruebe o rechace y escriba el motivo de la decisión.', 'Las aprobadas quedan listas para que el asesor las desembolse.'],
    preguntas: [['¿Quién puede resolver solicitudes?', 'Solo usuarios de gerencia. Su nombre queda registrado en la resolución.']],
  },
  cierres: {
    titulo: 'Cierres',
    proposito: 'Generar o consultar el cierre diario o mensual: desembolsos, recuperaciones por concepto, provisiones y devengo (UC-07).',
    pasos: ['Elija «Diario» o «Mensual» y el período.', 'Use «Consultar período» para revisar sin guardar: la suma por concepto cuadra con el total cobrado.', 'Use «Ejecutar cierre definitivo» para guardarlo; volver a ejecutarlo no duplica nada.'],
    preguntas: [['¿Puedo repetir un cierre?', 'Sí. La ejecución es idempotente: el resultado es el mismo y no duplica movimientos.']],
    conceptos: ['fecha', 'gasto'],
  },
  asistente: {
    titulo: 'Asistente gerencial',
    proposito: 'Hacer preguntas en lenguaje natural sobre la cartera, la mora, los cierres y las políticas. Funciona sin internet, con un modelo local.',
    pasos: [
      'Escriba su pregunta o toque una sugerencia.',
      'Las cifras del recuadro «Datos del núcleo» son las oficiales; el texto del asistente las resume.',
      'Las respuestas sobre políticas citan su fuente, por ejemplo [POL-2026-10].',
      'Si el asistente prepara un pago, revíselo y apruébelo usted: él no puede registrarlo.',
    ],
    preguntas: [
      ['Ejemplos de preguntas', '«¿Cómo está la cartera?» · «¿Qué créditos están en Mora 3?» · «¿Cuánto vence en los próximos 30 días?» · «Explícame la mora de la cuota 2 del crédito CV-2026-0410».'],
      ['Tarda en responder', 'El modelo corre en esta computadora; la primera respuesta puede tardar uno o dos minutos.'],
      ['Responde que solo ayuda con Crédito Vecino', 'Solo atiende temas de la operación y de sus políticas; otros temas se rechazan a propósito.'],
    ],
    conceptos: ['aprobacion', 'fecha'],
  },
};

// ── Estado compartido ─────────────────────────────────────────────────────
interface EstadoAyuda { seccion: SeccionAyuda; fijar: (s: SeccionAyuda) => void; abrir: () => void }
const ContextoAyuda = createContext<EstadoAyuda | null>(null);

export function ProveedorAyuda({ children }: { children: ReactNode }) {
  const [seccion, fijar] = useState<SeccionAyuda>('login');
  const [abierta, setAbierta] = useState(false);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); setAbierta(true); } };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);
  return (
    <ContextoAyuda.Provider value={{ seccion, fijar, abrir: () => setAbierta(true) }}>
      {children}
      <PanelAyuda seccion={seccion} abierta={abierta} cerrar={() => setAbierta(false)} />
    </ContextoAyuda.Provider>
  );
}

/** Indica qué ayuda corresponde a la pantalla visible. */
export function useSeccionAyuda(s: SeccionAyuda): void {
  const ctx = useContext(ContextoAyuda);
  useEffect(() => { ctx?.fijar(s); }, [ctx, s]);
}

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400';

/** Botón «?» de ayuda. `oscuro` para barras oscuras; claro para encabezados blancos. */
export function BotonAyuda({ oscuro = true }: { oscuro?: boolean }) {
  const ctx = useContext(ContextoAyuda);
  if (!ctx) return null;
  return (
    <button type="button" onClick={ctx.abrir} aria-label="Ayuda (F1)" title="Ayuda (F1)" aria-haspopup="dialog"
      className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${oscuro ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-100 text-[#0f172a] hover:bg-slate-200 border border-slate-200'} ${FOCO}`}>
      ?
    </button>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────
function PanelAyuda({ seccion, abierta, cerrar }: { seccion: SeccionAyuda; abierta: boolean; cerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [verGlosario, setVerGlosario] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierta && !d.open) { setVerGlosario(false); d.showModal?.(); }
    if (!abierta && d.open) d.close();
  }, [abierta]);

  const c = AYUDA[seccion];
  const conceptos = verGlosario ? (Object.keys(GLOSARIO) as Array<keyof typeof GLOSARIO>) : (c.conceptos ?? []);

  return (
    <dialog ref={ref} onClose={cerrar} onClick={(e) => { if (e.target === ref.current) cerrar(); }} aria-labelledby="ayuda-titulo"
      className="m-auto w-[min(100%-2rem,34rem)] max-h-[85vh] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/50">
      <div className="flex flex-col max-h-[85vh]">
        <div className="bg-[#0f172a] text-white px-5 py-4 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wide text-teal-300 font-bold">Ayuda</p>
            <h2 id="ayuda-titulo" className="text-lg font-bold" style={{ fontFamily: 'Outfit, Inter, sans-serif' }}>{c.titulo}</h2>
          </div>
          <button type="button" onClick={cerrar} aria-label="Cerrar ayuda" className={`w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-lg ${FOCO}`}>×</button>
        </div>

        <div className="overflow-auto px-5 py-4 flex flex-col gap-4 text-sm text-[#0f172a]">
          <p className="text-slate-700">{c.proposito}</p>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Cómo se usa</h3>
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-slate-700">{c.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
          </section>

          {c.preguntas.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Preguntas frecuentes</h3>
              <div className="flex flex-col gap-1.5">
                {c.preguntas.map(([p, r]) => (
                  <details key={p} className="border border-slate-200 rounded-xl px-3 py-2">
                    <summary className="cursor-pointer font-semibold text-[13px]">{p}</summary>
                    <p className="mt-1 text-slate-600 text-[13px]">{r}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {conceptos.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{verGlosario ? 'Glosario' : 'Conceptos de esta pantalla'}</h3>
              <dl className="flex flex-col gap-2">
                {conceptos.map((k) => (
                  <div key={k} className="bg-slate-50 rounded-xl px-3 py-2">
                    <dt className="font-semibold text-[13px]">{GLOSARIO[k][0]}</dt>
                    <dd className="text-slate-600 text-[13px]">{GLOSARIO[k][1]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {!verGlosario && (
            <button type="button" onClick={() => setVerGlosario(true)} className={`self-start text-[13px] font-semibold text-teal-700 underline ${FOCO}`}>
              Ver el glosario completo
            </button>
          )}

          <section className="border-t border-slate-100 pt-3 text-[12px] text-slate-500 flex flex-col gap-1">
            <p><strong className="text-slate-700">Atajos:</strong> F1 abre esta ayuda · Esc la cierra.</p>
            <p><strong className="text-slate-700">Soporte:</strong> si algo no funciona, anote la pantalla, la hora y el mensaje que aparece, y avise a su supervisor o al administrador del sistema.</p>
            <p>SGMC · Crédito Vecino, S. A. · Las cifras provienen del núcleo financiero.</p>
          </section>
        </div>
      </div>
    </dialog>
  );
}
