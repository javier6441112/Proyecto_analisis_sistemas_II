import { useEffect, useRef, useState } from 'react';
import { EncabezadoPagina } from '../App';
import { api, mensajeDeError, type TRespuestaChat, type TPropuestaPagoChat } from '../api';
import { Q, fecha } from '../formato';
import { useSesion } from '../sesion';
import { Alert, DISPLAY, FOCO, Ico } from '../ui';
import { conversacion, useConversacion } from './conversacion';

const SUGERENCIAS = [
  '¿Cuál es la cartera en riesgo?',
  '¿Qué créditos están en Mora 2?',
  '¿Cuánto vence en los próximos 30 días?',
  '¿Cómo se calcula la mora escalonada?',
];

/**
 * Asistente gerencial: las cifras salen de herramientas del núcleo (tarjetas), nunca del modelo.
 * La conversación vive en `conversacion.ts`, así que se conserva al cambiar de pantalla.
 */
export default function Asistente() {
  const s = useSesion();
  const { mensajes, pensando, borrador: texto } = useConversacion();
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensajes, pensando]);

  const enviar = (pregunta: string) => conversacion.enviar(pregunta, s.fecha);
  const nueva = () => conversacion.nueva();

  return (
    <div className="p-4 md:p-8 flex flex-col gap-4 max-w-4xl h-full min-h-0">
      <EncabezadoPagina titulo="Asistente gerencial" sub={`Consultas sobre la cartera al ${fecha(s.fecha)}. Las cifras provienen del núcleo financiero.`}>
        {mensajes.length > 0 && (
          <button onClick={nueva} className={`text-xs font-semibold border border-slate-200 bg-white rounded-xl px-3 py-2 text-slate-600 ${FOCO}`}>Nueva conversación</button>
        )}
      </EncabezadoPagina>

      <div className="flex-1 min-h-[300px] overflow-auto bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-4" aria-live="polite">
        {mensajes.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-8">
            <div className="w-12 h-12 rounded-2xl bg-[#0f172a] flex items-center justify-center">{Ico.chat('#5eead4')}</div>
            <p className="font-bold text-slate-700" style={DISPLAY}>¿Qué quieres saber de la cartera?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGERENCIAS.map((q) => (
                <button key={q} onClick={() => void enviar(q)} className={`text-xs border border-slate-200 rounded-full px-3 py-2 text-slate-600 hover:bg-slate-50 ${FOCO}`}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {mensajes.map((m, i) => {
          if (m.de === 'persona') return <div key={i} className="self-end max-w-[85%] bg-[#0f172a] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm">{m.texto}</div>;
          if (m.de === 'error') return <div key={i} className="max-w-[85%]"><Alert type="error">{m.texto}</Alert></div>;
          return <Respuesta key={i} r={m.r} />;
        })}
        {pensando && <div className="self-start text-sm text-slate-500 flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-teal-500 animate-spin" aria-hidden="true" />Consultando el núcleo…</div>}
        <div ref={fin} />
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        <label htmlFor="pregunta" className="sr-only">Pregunta</label>
        <input id="pregunta" value={texto} onChange={(e) => conversacion.escribir(e.target.value)} maxLength={2000} placeholder="Escribe tu pregunta…"
          className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400" />
        <button type="submit" disabled={pensando || !texto.trim()} className={`bg-[#0f172a] text-white rounded-xl px-5 text-sm font-bold disabled:opacity-50 ${FOCO}`} style={DISPLAY}>Enviar</button>
      </form>
    </div>
  );
}

export function Respuesta({ r }: { r: TRespuestaChat }) {
  return (
    <div className="self-start max-w-[92%] flex flex-col gap-2">
      <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3 text-sm text-[#0f172a] whitespace-pre-wrap">{r.respuesta}</div>
      {r.alertasSeguridad.length > 0 && <Alert type="warning">{r.alertasSeguridad.join(' · ')}</Alert>}
      {r.tarjetas.filter((t) => t.error).map((t, i) => {
        const error = t.datos.error as { mensaje?: unknown } | undefined;
        return <Alert key={`error-${i}`} type="error">{typeof error?.mensaje === 'string' ? error.mensaje : `No se pudo ejecutar ${t.herramienta}.`}</Alert>;
      })}
      {r.tarjetas.filter((t) => !t.error && t.herramienta !== 'proponer_pago' && t.herramienta !== 'buscar_politicas').map((t, i) => <TarjetaNucleo key={i} t={t} />)}
      {r.citas.length > 0 && (
        <p className="text-[11px] text-slate-500">Fuentes: {r.citas.map((c) => `[${c.docId}] ${c.titulo} (vigencia ${c.vigencia})`).join(' · ')}</p>
      )}
      {r.propuestas.map((p) => <PropuestaPago key={p.propuestaId} datos={p} />)}
    </div>
  );
}

/** Propuesta de pago del chat: solo una persona puede aprobarla (emite el token que exige el registro). */
export function PropuestaPago({ datos: p }: { datos: TPropuestaPagoChat }) {
  const s = useSesion();
  const [estado, setEstado] = useState<'pendiente' | 'aprobada' | 'rechazada'>(conversacion.decision(p.propuestaId) ?? 'pendiente');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const decidir = async (aprobar: boolean) => {
    setOcupado(true);
    setError('');
    try {
      if (aprobar) await api.aprobarPropuesta(p.propuestaId);
      else await api.rechazarPropuesta(p.propuestaId);
      setEstado(aprobar ? 'aprobada' : 'rechazada');
      conversacion.decidir(p.propuestaId, aprobar ? 'aprobada' : 'rechazada'); // se conserva al volver a la pantalla
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex flex-col gap-2 text-sm">
      <p className="font-bold text-amber-900" style={DISPLAY}>Propuesta de pago · requiere aprobación</p>
      <p className="text-amber-800 text-xs">
        Crédito <span className="font-mono">{p.idCredito}</span> · Total {Q(p.cuota.totalExigible)} · {fecha(p.fechaPago)}
        {` · saldo resultante ${Q(p.saldoCapitalResultante)}`}
      </p>
      <p className="text-amber-800 text-xs">
        Gastos {Q(p.aplicacion.gastos)} · Interés moratorio {Q(p.aplicacion.interesMoratorio)} · Interés corriente {Q(p.aplicacion.interesCorriente)} · Capital {Q(p.aplicacion.capital)}
      </p>
      {estado === 'pendiente' ? (
        <div className="flex gap-2">
          <button disabled={ocupado} onClick={() => void decidir(false)} className={`flex-1 border border-red-200 bg-white text-red-600 rounded-xl py-2.5 text-xs font-semibold ${FOCO}`}>Rechazar</button>
          <button disabled={ocupado} onClick={() => void decidir(true)} className={`flex-1 bg-[#0f172a] text-white rounded-xl py-2.5 text-xs font-bold disabled:opacity-50 ${FOCO}`}>{ocupado ? 'Registrando…' : `Aprobar como ${s.usuario}`}</button>
        </div>
      ) : (
        <Alert type={estado === 'aprobada' ? 'success' : 'info'}>{estado === 'aprobada' ? 'Pago aprobado y registrado.' : 'Propuesta rechazada; no se registró ningún pago.'}</Alert>
      )}
      {error && <Alert type="error">{error}</Alert>}
    </div>
  );
}

type Tarjeta = TRespuestaChat['tarjetas'][number];
interface FilaCredito { idCredito: string; cliente?: string; diasAtraso?: number; tramo?: string; saldoCapital?: { valor: string; moneda: 'GTQ' } }

/** Tarjeta con los datos tal como los devolvió el núcleo: el resumen y, si es una lista, todas sus filas. */
function TarjetaNucleo({ t }: { t: Tarjeta }) {
  const resumen = typeof t.datos.resumen === 'string' ? t.datos.resumen : '';
  const filas = Array.isArray(t.datos.creditos) ? (t.datos.creditos as FilaCredito[]) : [];
  return (
    <div className="border border-teal-200 bg-teal-50/50 rounded-xl px-3 py-2 text-xs text-[#0f172a]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Datos del núcleo · {t.herramienta}</p>
      {resumen && <p className="mt-1">{resumen}</p>}
      {filas.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-teal-700 font-semibold">Ver los {filas.length} créditos</summary>
          <table className="mt-1 w-full text-left">
            <thead><tr className="text-slate-500"><th>Crédito</th><th>Cliente</th><th className="text-right">Días</th><th className="text-right">Saldo</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.idCredito} className="border-t border-teal-100">
                  <td className="py-0.5 font-mono">{f.idCredito}</td><td>{f.cliente ?? ''}</td>
                  <td className="text-right">{f.diasAtraso ?? ''}</td><td className="text-right">{f.saldoCapital ? Q(f.saldoCapital) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
