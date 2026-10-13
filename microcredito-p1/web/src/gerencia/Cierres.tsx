import { useState } from 'react';
import { EncabezadoPagina } from '../App';
import { api, mensajeDeError, type TCierre } from '../api';
import { Q, fecha } from '../formato';
import { useSesion } from '../sesion';
import { Alert, Badge, BtnPrimary, BtnSecondary, DISPLAY, FOCO, Field, Ico, inputCls } from '../ui';

type Tipo = 'diario' | 'mensual';

/** Movimientos que entran al cierre: desembolsos, pagos, recuperaciones de incobrables y bajas a incobrable. */
const movimientos = (c: TCierre): number =>
  c.desembolsos.cantidad + c.recuperaciones.pagos + c.recuperacionesIncobrables.pagos + c.incobrablesDelPeriodo.creditos.length;

export default function Cierres() {
  const s = useSesion();
  const [tipo, setTipo] = useState<Tipo>('diario');
  const [periodo, setPeriodo] = useState(s.fecha);
  const [cierre, setCierre] = useState<TCierre | null>(null);
  const [verificacion, setVerificacion] = useState<'igual' | 'distinto' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  // Al cambiar de tipo se limpian la selección y los resultados del cierre anterior.
  const cambiarTipo = (t: Tipo) => {
    setTipo(t);
    setPeriodo(t === 'diario' ? s.fecha : s.fecha.slice(0, 7));
    setCierre(null);
    setVerificacion(null);
    setError('');
  };

  const consultar = async () => {
    setCargando(true);
    setError('');
    setVerificacion(null);
    try {
      setCierre(await api.cierre(periodo));
    } catch (err) {
      setCierre(null);
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  };

  const reejecutar = async () => {
    if (!cierre) return;
    setCargando(true);
    try {
      const otra = await api.cierre(cierre.periodo);
      setVerificacion(JSON.stringify(otra) === JSON.stringify(cierre) ? 'igual' : 'distinto');
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  };

  const abierto = cierre !== null && cierre.hasta > s.fecha;

  return (
    <div className="p-4 md:p-8 flex flex-col gap-6 max-w-3xl">
      <EncabezadoPagina titulo="Cierre contable" sub="Genera o consulta cierres diarios y mensuales" />

      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Tipo de cierre</p>
          <div className="flex gap-3" role="group" aria-label="Tipo de cierre">
            {(['diario', 'mensual'] as const).map((t) => (
              <button key={t} onClick={() => cambiarTipo(t)} aria-pressed={tipo === t}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold border ${FOCO} ${tipo === t ? 'bg-[#0f172a] text-white border-[#0f172a]' : 'bg-white text-slate-600 border-slate-200'}`}>
                {t === 'diario' ? 'Diario' : 'Mensual'}
              </button>
            ))}
          </div>
        </div>
        <Field id="periodo-cierre" label={tipo === 'diario' ? 'Fecha de corte' : 'Mes del cierre'}
          hint="Las cifras salen de la bitácora de operaciones; consultar el mismo periodo siempre devuelve el mismo resultado.">
          <input id="periodo-cierre" type={tipo === 'diario' ? 'date' : 'month'} className={inputCls} value={periodo}
            onChange={(e) => { setPeriodo(e.target.value); setCierre(null); setVerificacion(null); }} />
        </Field>
        <BtnPrimary label="Ejecutar cierre" onClick={() => void consultar()} busy={cargando && !cierre} disabled={!periodo} />
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {cierre && (
        <>
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">{Ico.check(20)}</div>
            <div>
              <p className="font-bold text-emerald-800" style={DISPLAY}>Cierre {cierre.tipo === 'DIARIO' ? 'diario' : 'mensual'} · {fecha(cierre.periodo)}</p>
              <p className="text-emerald-700 text-xs mt-0.5">
                Del {fecha(cierre.desde)} al {fecha(cierre.hasta)} · {movimientos(cierre)} movimientos incluidos. Las cifras son reproducibles: una nueva ejecución devuelve el mismo resultado y no genera movimientos adicionales.
              </p>
            </div>
          </div>
          {abierto && (
            <Alert type="warning">El periodo termina el {fecha(cierre.hasta)}, después de la fecha de operación ({fecha(s.fecha)}). Incluye solo lo registrado hasta hoy; las operaciones posteriores dentro del periodo cambiarán las cifras.</Alert>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-1">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-[#0f172a] text-sm" style={DISPLAY}>Cifras del cierre</p>
              <Badge label="Generado" color="green" />
            </div>
            {([
              ['Periodo', `${fecha(cierre.desde)} – ${fecha(cierre.hasta)}`],
              ['Desembolsos', `${Q(cierre.desembolsos.monto)} (${cierre.desembolsos.cantidad})`],
              ['Recuperaciones totales', `${Q(cierre.recuperaciones.total)} (${cierre.recuperaciones.pagos} pagos)`],
              ['· Gastos de gestión', Q(cierre.recuperaciones.gastos)],
              ['· Interés moratorio recaudado', Q(cierre.recuperaciones.interesMoratorio)],
              ['· Interés corriente recaudado', Q(cierre.recuperaciones.interesCorriente)],
              ['· Capital recuperado', Q(cierre.recuperaciones.capital)],
              ['Recuperación de incobrables', `${Q(cierre.recuperacionesIncobrables.monto)} (${cierre.recuperacionesIncobrables.pagos})`],
              ['Declarado incobrable en el periodo', `${Q(cierre.incobrablesDelPeriodo.monto)} (${cierre.incobrablesDelPeriodo.creditos.length})`],
              ['Cartera activa al corte', Q(cierre.cartera.resumen.carteraActiva)],
              ['Cartera en mora', Q(cierre.cartera.carteraEnMora)],
              ['Cartera en riesgo', Q(cierre.cartera.resumen.saldoEnRiesgo)],
              ['Incobrable acumulado', Q(cierre.cartera.resumen.incobrable)],
              ['N° de movimientos incluidos', `${movimientos(cierre)} movimientos`],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 text-sm">
                <span className="text-slate-600">{k}</span>
                <span className="font-mono font-bold text-[#0f172a] text-right">{v}</span>
              </div>
            ))}
          </div>

          {cierre.desembolsos.creditos.length > 0 && (
            <details className="bg-white rounded-2xl border border-slate-200 p-4">
              <summary className={`text-sm font-semibold text-[#0f172a] cursor-pointer ${FOCO}`}>Créditos desembolsados ({cierre.desembolsos.creditos.length})</summary>
              <div className="mt-2 flex flex-col divide-y divide-slate-100 text-xs">
                {cierre.desembolsos.creditos.map((c) => (
                  <div key={c.idCredito} className="flex justify-between gap-2 py-2">
                    <span><span className="font-mono text-slate-500">{c.idCredito}</span> · {c.nombreCliente} · {fecha(c.fecha)}</span>
                    <span className="font-mono font-semibold">{Q(c.capital)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {verificacion === 'igual' && <Alert type="success">Idempotencia verificada: se devolvió el mismo cierre y no se duplicaron movimientos. Las cifras son idénticas antes y después de la comprobación.</Alert>}
          {verificacion === 'distinto' && <Alert type="error">La segunda ejecución devolvió cifras distintas. Revise si se registraron operaciones dentro del periodo entre ambas consultas.</Alert>}

          <div className="flex flex-col sm:flex-row gap-3">
            <BtnSecondary label={cargando ? 'Comprobando…' : 'Reejecutar comprobación'} onClick={() => void reejecutar()} disabled={cargando} />
            <BtnSecondary label="Nuevo cierre" onClick={() => cambiarTipo(tipo)} />
          </div>
        </>
      )}
    </div>
  );
}
