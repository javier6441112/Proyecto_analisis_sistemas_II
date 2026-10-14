import { useState } from 'react';
import type { Ir } from '../App';
import {
  api, mensajeDeError, type TCanal, type TCreditoResumen, type TCuotaExigible, type TDetalleCredito, type TPagoAplicadoRespuesta,
  type TPagoDuplicadoRespuesta, type TSimulacionPago, type TPagoBody,
} from '../api';
import { ETIQUETA_CANAL, ETIQUETA_ESTADO, ETIQUETA_TRAMO, Q, fecha, normalizarMonto } from '../formato';
import { useSesion } from '../sesion';
import {
  Alert, BtnPrimary, BtnSecondary, Buscador, Cabecera, ConCarga, DISPLAY, Exito, FOCO, Field, Filas, Ico, Pantalla, Seccion,
  TopBar, inputCls, useCarga, useDiferido,
} from '../ui';

type Aceptable = Extract<TSimulacionPago, { resultado: 'ACEPTABLE' }>;
type Resultado = TPagoAplicadoRespuesta | TPagoDuplicadoRespuesta;
type OperacionPago = { idCredito: string; cuerpo: TPagoBody; claveIdempotencia: string };

export default function Pagos({ ir, idInicial }: { ir: Ir; idInicial?: string }) {
  const [id, setId] = useState(idInicial ?? '');
  if (id) return <RegistrarPago id={id} volver={() => setId('')} ir={ir} />;
  return <BuscarCredito elegir={setId} ir={ir} />;
}

// ── Paso 1: buscar el crédito ────────────────────────────────────────────
function BuscarCredito({ elegir, ir }: { elegir: (id: string) => void; ir: Ir }) {
  const s = useSesion();
  const [texto, setTexto] = useState('');
  const busqueda = useDiferido(texto.trim());
  const buscando = busqueda.length > 1;
  // Sin texto: los créditos del asesor. Con texto: cualquier crédito (cobro de otro asesor en campo).
  const carga = useCarga(() => api.creditos(s.fecha, buscando ? { q: busqueda } : { idAsesor: s.idAsesor }), [s.fecha, busqueda, s.idAsesor]);

  return (
    <Pantalla barra={<TopBar title="Registrar pago" onBack={() => ir({ tab: 'inicio' })} />}>
      <Buscador id="buscar-pago" value={texto} onChange={setTexto} placeholder="Nombre del cliente o código de crédito…" />
      <ConCarga carga={carga}>
        {({ creditos }) => {
          const lista = creditos
            .filter((c) => c.estado !== 'CANCELADO' && c.estado !== 'INCOBRABLE')
            .sort((a, b) => b.diasAtraso - a.diasAtraso);
          return (
            <Seccion titulo={buscando ? `${lista.length} resultado${lista.length === 1 ? '' : 's'}` : 'Mis créditos por cobrar'}>
              {lista.length === 0 ? (
                <p className="text-sm text-slate-600 text-center py-6">Sin créditos con saldo{buscando ? ` para «${texto}»` : ''}.</p>
              ) : (
                <div className="flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 shadow-sm">
                  {lista.map((c) => <FilaCobro key={c.idCredito} c={c} onClick={() => elegir(c.idCredito)} />)}
                </div>
              )}
            </Seccion>
          );
        }}
      </ConCarga>
    </Pantalla>
  );
}

function FilaCobro({ c, onClick }: { c: TCreditoResumen; onClick: () => void }) {
  const mora = c.diasAtraso > 0;
  const badge = !mora ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : c.diasAtraso > 90 ? 'bg-red-100 text-red-800 border-red-300' : 'bg-red-50 text-red-700 border-red-200';
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-400 active:bg-slate-50">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${mora ? 'bg-red-500' : 'bg-emerald-400'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[#0f172a]">{c.nombreCliente}</span>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${badge}`}>{ETIQUETA_TRAMO[c.tramo]}</span>
        </span>
        <span className="block text-xs font-mono text-slate-600 mt-0.5">{c.idCredito} · Saldo {Q(c.saldoCapital)}</span>
        <span className="flex items-center gap-3 mt-0.5">
          <span className={`text-xs font-medium ${mora ? 'text-red-600' : 'text-slate-500'}`}>
            {mora ? `${c.diasAtraso} días de atraso` : c.proximaCuota ? `Vence ${fecha(c.proximaCuota.fechaVencimiento)}` : ETIQUETA_ESTADO[c.estado]}
          </span>
          {c.proximaCuota && !mora && <span className="text-xs text-slate-600">Cuota {Q(c.proximaCuota.monto)}</span>}
        </span>
      </span>
      <span className="text-slate-300 shrink-0">{Ico.chevRight()}</span>
    </button>
  );
}

// ── Pasos 2–4: exigible → revisión → comprobante ─────────────────────────
export function RegistrarPago({ id, volver, ir }: { id: string; volver: () => void; ir: Ir }) {
  const s = useSesion();
  const [fechaPago, setFechaPago] = useState(s.fecha);
  const [monto, setMonto] = useState('');
  const [canal, setCanal] = useState<TCanal>('campo');
  const [paso, setPaso] = useState<'formulario' | 'revision' | 'hecho'>('formulario');
  const [simulacion, setSimulacion] = useState<Aceptable | null>(null);
  const [clave, setClave] = useState('');
  const [aprobado, setAprobado] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [operacion, setOperacion] = useState<OperacionPago | null>(null);

  const exigible = useCarga(async () => {
    const r = await api.exigible(id, fechaPago);
    if (!('credito' in r)) throw new Error('Respuesta inesperada al consultar lo exigible');
    if (r.cuota) setMonto(r.cuota.total.valor); // El servidor exige saldar la cuota exacta: se propone su total.
    return r;
  }, [id, fechaPago]);

  const revisar = async () => {
    const m = normalizarMonto(monto);
    if (!m || m === '0.00') return setError('Ingresa un monto válido, con máximo dos decimales.');
    setOcupado(true);
    setError('');
    try {
      const r = await api.simularPago(id, fechaPago, m);
      if ('resultado' in r && r.resultado === 'ACEPTABLE') {
        setMonto(m);
        setSimulacion(r);
        setClave(crypto.randomUUID()); // Una clave por pago revisado: los reintentos no cobran dos veces.
        setOperacion(null);
        setAprobado(false);
        setPaso('revision');
      } else if ('resultado' in r && r.resultado === 'RECHAZADO') {
        setError(r.mensaje);
      } else {
        setError('El servidor no aceptó la simulación del pago.');
      }
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const enviarOperacion = async (original: OperacionPago) => {
    if (ocupado) return;
    setOcupado(true);
    setError('');
    try {
      const r = await api.registrarPago(original.idCredito, original.cuerpo, original.claveIdempotencia);
      setResultado(r);
      setPaso('hecho');
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async () => {
    if (!simulacion || !aprobado || ocupado) return;
    const original = operacion ?? {
      idCredito: id,
      cuerpo: { monto, fechaPago, canal, aprobacion: { aprobado: true, aprobadoPor: s.usuario } },
      claveIdempotencia: clave,
    };
    // Guarda la solicitud antes de enviarla; incluso un error de red conserva el pago original.
    setOperacion(original);
    await enviarOperacion(original);
  };

  if (paso === 'hecho' && resultado && operacion) {
    return <Comprobante r={resultado} d={resultado.credito} fechaPago={operacion.cuerpo.fechaPago} canal={operacion.cuerpo.canal} ir={ir}
      reenviar={() => void enviarOperacion(operacion)} ocupado={ocupado} error={error} />;
  }

  return (
    <ConCarga carga={exigible} texto="Consultando lo exigible…">
      {(ex) => {
        const d = ex.credito;
        const encabezado = (
          <Cabecera>
            <p className="text-slate-400 text-xs">{d.nombreCliente} · {d.idCredito}</p>
            <p className="text-white text-sm font-semibold mt-0.5">
              {d.diasAtraso > 0 ? `${d.diasAtraso} días de atraso — ${ETIQUETA_TRAMO[d.tramo]}` : 'Al día'} · saldo {Q(d.saldoCapital)}
            </p>
          </Cabecera>
        );

        if (paso === 'revision' && simulacion) {
          const a = simulacion.aplicacion.aplicado;
          return (
            <Pantalla barra={<><TopBar title="Revisar pago" onBack={() => setPaso('formulario')} />{encabezado}</>}>
              <Filas filas={[
                ['Cliente', d.nombreCliente],
                ['Crédito', <span className="font-mono">{d.idCredito}</span>],
                ['Cuota que se salda', `${simulacion.cuota.numero} (venc. ${fecha(simulacion.cuota.fechaVencimiento)})`],
                ['Atraso', `${simulacion.cuota.diasAtraso} días — ${ETIQUETA_TRAMO[simulacion.cuota.tramo]}`],
                ['Total a registrar', <span className="text-teal-700">{Q(monto)}</span>],
                ['Fecha de recepción', fecha(fechaPago)],
                ['Canal', ETIQUETA_CANAL[canal]],
              ]} />
              <Seccion titulo="Aplicación (prelación)">
                <Prelacion g={a.gastos.valor} m={a.interesMoratorio.valor} i={a.interesCorriente.valor} k={a.capital.valor} total={monto} />
              </Seccion>
              <Filas filas={[['Saldo de capital después del pago', Q(simulacion.saldoCapitalResultante)]]} />
              <Alert type="warning">Este pago es definitivo. Se aplicará en el orden de prelación y no puede revertirse.</Alert>
              <label className={`flex items-start gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 cursor-pointer ${FOCO}`}>
                <input type="checkbox" checked={aprobado} onChange={(e) => setAprobado(e.target.checked)} className="mt-0.5 w-5 h-5 accent-teal-600 shrink-0" />
                <span>Revisé el desglose y apruebo registrar este pago. <span className="text-slate-500">Queda a nombre de {s.usuario}.</span></span>
              </label>
              {error && <Alert type="error">{error}</Alert>}
              <div className="flex gap-3">
                <BtnSecondary label="Modificar monto" onClick={() => setPaso('formulario')} />
                <BtnSecondary label="Cancelar" danger onClick={volver} />
              </div>
              <BtnPrimary label="Confirmar pago" onClick={() => void confirmar()} disabled={!aprobado} busy={ocupado} />
            </Pantalla>
          );
        }

        return (
          <Pantalla barra={<><TopBar title="Registrar pago" onBack={volver} />{encabezado}</>}>
            {!ex.permitePago && <Alert type="error">{ex.mensaje ?? 'Este crédito no admite pagos.'}</Alert>}
            {ex.permitePago && ex.cuota && <Exigible cuota={ex.cuota} d={d} />}
            {ex.permitePago && (
              <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void revisar(); }} noValidate>
                <Field id="monto-recibido" label="Monto recibido del cliente" hint={ex.cuota ? `Debe saldar exactamente la cuota ${ex.cuota.numero}: ${Q(ex.cuota.total)}.` : undefined} error={error || undefined}>
                  <input id="monto-recibido" inputMode="decimal" className={inputCls} value={monto} aria-invalid={Boolean(error)}
                    onChange={(e) => { setMonto(e.target.value); setError(''); }} />
                </Field>
                <Field id="fecha-pago" label="Fecha de recepción" hint="Cambiarla recalcula la mora a esa fecha.">
                  <input id="fecha-pago" type="date" className={inputCls} value={fechaPago} onChange={(e) => e.target.value && setFechaPago(e.target.value)} />
                </Field>
                <Field id="canal" label="Canal">
                  <select id="canal" className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value as TCanal)}>
                    {(['campo', 'agencia', 'transferencia'] as const).map((c) => <option key={c} value={c}>{ETIQUETA_CANAL[c]}</option>)}
                  </select>
                </Field>
                <div className="flex gap-3">
                  <BtnSecondary label="Cancelar" danger onClick={volver} />
                  <BtnPrimary type="submit" label="Revisar pago" busy={ocupado} />
                </div>
              </form>
            )}
          </Pantalla>
        );
      }}
    </ConCarga>
  );
}

function Exigible({ cuota, d }: { cuota: TCuotaExigible; d: TDetalleCredito }) {
  const mora = cuota.diasAtraso > 0;
  return (
    <>
      <div className={`${mora ? 'bg-red-50 border-red-200' : 'bg-teal-50 border-teal-200'} border rounded-2xl p-4`}>
        <p className={`text-xs font-semibold mb-1 ${mora ? 'text-red-700' : 'text-teal-700'}`}>Total a pagar · cuota {cuota.numero} de {d.cuotasTotales}</p>
        <p className={`text-3xl font-extrabold ${mora ? 'text-red-700' : 'text-teal-700'}`} style={DISPLAY}>{Q(cuota.total)}</p>
        <p className={`text-[11px] mt-0.5 ${mora ? 'text-red-600' : 'text-teal-600'}`}>
          Vence {fecha(cuota.fechaVencimiento)}{mora ? ` · ${cuota.diasAtraso} días de atraso` : ''}. Orden: gastos → interés de mora → interés corriente → capital.
        </p>
      </div>
      <Seccion titulo="Desglose (prelación)">
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-3">
          <p className="text-xs font-semibold text-slate-700">Prioridad legal de aplicación</p>
          <p className="text-xs text-slate-600 mt-0.5">1° Gastos · 2° Mora · 3° Interés pactado · 4° Reducción a capital</p>
        </div>
        <Prelacion g={cuota.gastoGestion.valor} m={cuota.interesMoratorio.valor} i={cuota.interesCorriente.valor} k={cuota.capital.valor} total={cuota.total.valor} />
      </Seccion>
      {d.cuotasVencidas.length > 1 && (
        <Alert type="info">Tiene {d.cuotasVencidas.length} cuotas vencidas ({Q(d.totalVencidoExigible)} en total). Cada pago salda la más antigua.</Alert>
      )}
    </>
  );
}

function Prelacion({ g, m, i, k, total }: { g: string; m: string; i: string; k: string; total: string }) {
  const filas = [['Gastos de gestión', g], ['Interés de mora', m], ['Interés corriente', i], ['Capital', k]] as const;
  return (
    <div>
      {filas.map(([concepto, valor], n) => (
        <div key={concepto} className="flex items-center justify-between py-2.5 border-b border-slate-100">
          <span className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold flex items-center justify-center">{n + 1}</span>
            {concepto}
          </span>
          <span className="font-mono font-semibold text-[#0f172a] text-sm">{Q(valor)}</span>
        </div>
      ))}
      <div className="flex justify-between py-2 mt-1 text-sm font-bold">
        <span>Total</span><span className="font-mono text-teal-700">{Q(total)}</span>
      </div>
    </div>
  );
}

function Comprobante({ r, d, fechaPago, canal, ir, reenviar, ocupado, error }: {
  r: Resultado; d: TDetalleCredito; fechaPago: string; canal: TCanal; ir: Ir;
  reenviar: () => void; ocupado: boolean; error: string;
}) {
  const duplicado = r.resultado === 'DUPLICADO';
  const aplicado = duplicado ? r.pagoOriginal.aplicado : r.aplicacion.aplicado;
  const monto = duplicado ? r.pagoOriginal.monto : r.cuota.total;
  const cr = r.credito;
  return (
    <Pantalla barra={<TopBar title="Comprobante de pago" />}>
      {duplicado && <Alert type="info">Este pago ya fue procesado. No se realizó un segundo cobro; se muestra el registro original.</Alert>}
      <Exito titulo="Pago registrado">
        <p className="text-slate-500 text-sm">{d.nombreCliente} · {d.idCredito}</p>
      </Exito>
      <Filas filas={[
        ['Resultado', r.resultado],
        ['N° de operación', <span className="font-mono text-xs break-all">{r.claveIdempotencia}</span>],
        ['Cliente', d.nombreCliente],
        ['Crédito', <span className="font-mono">{d.idCredito}</span>],
        ['Fecha de recepción', fecha(duplicado ? r.pagoOriginal.fecha : fechaPago)],
        ['Canal', ETIQUETA_CANAL[duplicado ? r.pagoOriginal.canal : canal] ?? canal],
        ['Monto recibido', Q(monto)],
        ['Nuevo saldo', Q(cr.saldoCapital)],
        ['Estado del crédito', cr.diasAtraso > 0 ? `${ETIQUETA_TRAMO[cr.tramo]} — ${cr.diasAtraso} días` : ETIQUETA_ESTADO[cr.estado]],
      ]} />
      {aplicado && (
        <Seccion titulo="Desglose aplicado">
          <Prelacion g={aplicado.gastos.valor} m={aplicado.interesMoratorio.valor} i={aplicado.interesCorriente.valor} k={aplicado.capital.valor} total={monto.valor} />
        </Seccion>
      )}
      <Alert type="success"><span className="flex items-center gap-1.5">Registrado en el servidor con la clave de idempotencia mostrada.</span></Alert>
      {error && <Alert type="error">{error}</Alert>}
      <BtnSecondary label={ocupado ? 'Reenviando…' : 'Reenviar el mismo pago'} onClick={reenviar} disabled={ocupado} />
      <BtnPrimary label="Ver crédito" onClick={() => ir({ tab: 'creditos', idCredito: d.idCredito })} />
      <BtnSecondary label="Volver al inicio" onClick={() => ir({ tab: 'inicio' })} />
    </Pantalla>
  );
}
