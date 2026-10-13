import { useState } from 'react';
import type { Ir } from '../App';
import { api, mensajeDeError, type TCliente, type TPlanSimulado, type TSolicitud } from '../api';
import { ETIQUETA_ESTADO, Q, colorEstado, fecha, normalizarMonto, tasaAnual, tasaMensual } from '../formato';
import { LIMITES, TNA_BPS, useSesion } from '../sesion';
import {
  Alert, Badge, BtnPrimary, BtnSecondary, Buscador, Cabecera, ConCarga, DISPLAY, Exito, FOCO, Field, Filas, Ico, Pantalla,
  Seccion, TopBar, inputCls, useCarga, useDiferido,
} from '../ui';
import Desembolso from './Desembolso';
import { PlanAmortizacion } from './Creditos';

type Paso = 'lista' | 'formulario' | 'cliente' | 'resumen' | 'plan' | 'confirmar' | 'enviada' | 'desembolso';

interface Borrador {
  cliente: TCliente | null;
  monto: string;
  plazo: number;
}

export default function Solicitudes({ ir, idCliente, desembolsar }: { ir: Ir; idCliente?: string; desembolsar?: string }) {
  const s = useSesion();
  const [paso, setPaso] = useState<Paso>(desembolsar ? 'desembolso' : idCliente ? 'formulario' : 'lista');
  const [idDesembolso, setIdDesembolso] = useState(desembolsar ?? '');
  const [borrador, setBorrador] = useState<Borrador>({ cliente: null, monto: '10000', plazo: 12 });
  const [plan, setPlan] = useState<TPlanSimulado | null>(null);
  const [enviada, setEnviada] = useState<TSolicitud | null>(null);

  // Cliente preseleccionado desde Clientes.
  useCarga(async () => {
    if (!idCliente) return null;
    const c = (await api.clientes(idCliente)).find((x) => x.idCliente === idCliente) ?? null;
    setBorrador((b) => ({ ...b, cliente: c }));
    return c;
  }, [idCliente]);

  if (paso === 'desembolso') {
    return <Desembolso idSolicitud={idDesembolso} volver={() => setPaso('lista')} alInicio={() => ir({ tab: 'inicio' })}
      verCredito={(id) => ir({ tab: 'creditos', idCredito: id })} />;
  }
  if (paso === 'lista') {
    return <MisSolicitudes nueva={() => { setBorrador({ cliente: null, monto: '10000', plazo: 12 }); setPaso('formulario'); }}
      desembolsar={(id) => { setIdDesembolso(id); setPaso('desembolso'); }} ir={ir} />;
  }
  if (paso === 'cliente') {
    return <ElegirCliente volver={() => setPaso('formulario')} elegir={(c) => { setBorrador((b) => ({ ...b, cliente: c })); setPaso('formulario'); }} />;
  }
  if (paso === 'formulario') {
    return <Formulario borrador={borrador} setBorrador={setBorrador} elegirCliente={() => setPaso('cliente')} volver={() => setPaso('lista')}
      simular={(p) => { setPlan(p); setPaso('resumen'); }} />;
  }

  const c = borrador.cliente!;
  const p = plan!;
  const primera = p.cuotas[0]!;
  const ultima = p.cuotas[p.cuotas.length - 1]!;
  const ultimaDistinta = ultima.pago.valor !== primera.pago.valor;
  const encabezado = (
    <Cabecera>
      <p className="text-white font-semibold" style={DISPLAY}>{c.nombreCompleto} · {Q(p.capital)}</p>
      <p className="text-slate-400 text-xs mt-0.5">{tasaAnual(p.tnaBps)} anual · {tasaMensual(p.tnaBps)} mensual · {p.plazoMeses} meses · Sistema francés</p>
    </Cabecera>
  );
  const notaAjuste = ultimaDistinta && (
    <Alert type="info">
      La última cuota ({Q(ultima.pago)}) se ajusta para que la suma de los abonos a capital sea exactamente {Q(p.capital)} y el saldo final quede en Q0.00.
    </Alert>
  );

  if (paso === 'resumen') {
    return (
      <Pantalla barra={<><TopBar title="Resumen del plan" onBack={() => setPaso('formulario')} />{encabezado}</>}>
        <Filas filas={[
          ['Capital', Q(p.capital)],
          ['Plazo', `${p.plazoMeses} meses`],
          [ultimaDistinta ? `Cuotas 1 a ${p.cuotas.length - 1}` : 'Cuota mensual', `${Q(primera.pago)}${ultimaDistinta ? ' cada una' : ''}`],
          ultimaDistinta && [`Cuota ${p.cuotas.length}`, Q(ultima.pago)],
          ['Primer vencimiento', fecha(primera.fechaVencimiento)],
          ['Total de intereses', Q(p.totalIntereses)],
          ['Total a pagar', Q(p.totalPagado)],
          ['Saldo final', Q(ultima.saldoFinal)],
        ]} />
        {notaAjuste}
        <div className="flex flex-col gap-2">
          <BtnSecondary label="Modificar solicitud" onClick={() => setPaso('formulario')} />
          <button onClick={() => setPaso('plan')} className={`w-full border border-[#0f172a] bg-white rounded-xl py-4 text-sm font-bold text-[#0f172a] ${FOCO}`}>
            Ver plan completo ({p.cuotas.length} cuotas)
          </button>
          <BtnPrimary label="Confirmar solicitud" onClick={() => setPaso('confirmar')} />
        </div>
      </Pantalla>
    );
  }
  if (paso === 'plan') {
    return (
      <Pantalla barra={<><TopBar title="Plan de amortización" onBack={() => setPaso('resumen')} />{encabezado}</>}>
        <PlanAmortizacion cuotas={p.cuotas} />
        {notaAjuste}
        <div className="flex gap-3">
          <BtnSecondary label="Regresar y modificar" onClick={() => setPaso('formulario')} />
          <BtnPrimary label="Confirmar solicitud" onClick={() => setPaso('confirmar')} />
        </div>
      </Pantalla>
    );
  }
  if (paso === 'confirmar') {
    return <Confirmar cliente={c} plan={p} volver={() => setPaso('resumen')} enviada={(sol) => { setEnviada(sol); setPaso('enviada'); }} idAsesor={s.idAsesor!} />;
  }
  return (
    <Pantalla barra={<TopBar title="Solicitud enviada" />}>
      <Exito titulo="Solicitud enviada al comité">
        <p className="text-slate-500 text-sm">{enviada?.idSolicitud} · {enviada?.nombreCliente} · {Q(enviada?.capital)}</p>
        <p className="text-slate-600 text-xs">Pendiente de evaluación por el comité de crédito.</p>
      </Exito>
      <Alert type="info">La gerencia la verá en su bandeja del comité. Cuando sea aprobada, podrás desembolsarla desde Solicitudes.</Alert>
      <BtnPrimary label="Ver mis solicitudes" onClick={() => setPaso('lista')} />
      <BtnSecondary label="Volver al inicio" onClick={() => ir({ tab: 'inicio' })} />
    </Pantalla>
  );
}

// ── Bandeja del asesor ───────────────────────────────────────────────────
function MisSolicitudes({ nueva, desembolsar, ir }: { nueva: () => void; desembolsar: (id: string) => void; ir: Ir }) {
  const s = useSesion();
  const carga = useCarga(() => api.solicitudes(), []);
  return (
    <Pantalla barra={<TopBar title="Solicitudes" onBack={() => ir({ tab: 'inicio' })} />}>
      <BtnPrimary label="Nueva solicitud" onClick={nueva} />
      <ConCarga carga={carga}>
        {(todas) => {
          const mias = todas.filter((x) => x.idAsesor === s.idAsesor).reverse();
          return (
            <Seccion titulo="Mis solicitudes">
              {mias.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6 bg-white rounded-2xl border border-slate-100">Aún no has registrado solicitudes.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {mias.map((x) => (
                    <div key={x.idSolicitud} className="bg-white border border-slate-200 rounded-2xl px-4 py-4 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Badge label={ETIQUETA_ESTADO[x.estado]!} color={colorEstado(x.estado)} />
                        <span className="text-xs font-mono text-slate-600">{x.idSolicitud}</span>
                      </div>
                      <p className="text-sm font-bold text-[#0f172a]">{x.nombreCliente}</p>
                      <p className="text-xs text-slate-600">{Q(x.capital)} · {x.plazoMeses} meses · {fecha(x.fecha)}</p>
                      {x.resolucion && <p className="text-xs text-slate-500 italic">«{x.resolucion.motivo}» — {x.resolucion.usuario}</p>}
                      {x.estado === 'APROBADA' && (
                        <button onClick={() => desembolsar(x.idSolicitud)} className={`mt-1 w-full bg-[#0f172a] text-white rounded-xl py-3 text-sm font-bold ${FOCO}`} style={DISPLAY}>
                          Continuar al desembolso →
                        </button>
                      )}
                      {x.estado === 'DESEMBOLSADA' && x.idCredito && (
                        <button onClick={() => ir({ tab: 'creditos', idCredito: x.idCredito })} className={`mt-1 text-xs font-semibold text-teal-700 underline text-left ${FOCO}`}>
                          Ver crédito {x.idCredito} →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Seccion>
          );
        }}
      </ConCarga>
    </Pantalla>
  );
}

// ── Selección de cliente ─────────────────────────────────────────────────
function ElegirCliente({ volver, elegir }: { volver: () => void; elegir: (c: TCliente) => void }) {
  const [texto, setTexto] = useState('');
  const busqueda = useDiferido(texto.trim());
  const carga = useCarga(() => api.clientes(busqueda.length > 1 ? busqueda : undefined), [busqueda]);
  return (
    <Pantalla barra={<TopBar title="Seleccionar cliente" onBack={volver} />}>
      <Buscador id="buscar-sol" value={texto} onChange={setTexto} placeholder="Nombre, DPI o código" autoFocus />
      <ConCarga carga={carga}>
        {(clientes) => (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {clientes.length === 0 && <p className="px-4 py-4 text-sm text-slate-600 text-center">Sin resultados para «{texto}».</p>}
            {clientes.map((c) => (
              <button key={c.idCliente} onClick={() => elegir(c)} className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 ${FOCO}`}>
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-[#0f172a] shrink-0">{Ico.user('white')}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-[#0f172a]">{c.nombreCompleto}</span>
                  <span className="block text-xs text-slate-600 font-mono mt-0.5">{c.idCliente} · DPI {c.dpi}</span>
                </span>
                <span className="text-slate-300 shrink-0">{Ico.chevRight()}</span>
              </button>
            ))}
          </div>
        )}
      </ConCarga>
    </Pantalla>
  );
}

// ── Formulario con cuota estimada por el servidor ────────────────────────
function Formulario({ borrador, setBorrador, elegirCliente, volver, simular }: {
  borrador: Borrador;
  setBorrador: (f: (b: Borrador) => Borrador) => void;
  elegirCliente: () => void;
  volver: () => void;
  simular: (p: TPlanSimulado) => void;
}) {
  const s = useSesion();
  const [error, setError] = useState<Record<string, string>>({});
  const [falla, setFalla] = useState('');
  const { cliente, monto, plazo } = borrador;

  const montoNormal = normalizarMonto(monto);
  const montoNum = montoNormal ? Number(montoNormal) : NaN;
  const montoValido = montoNormal !== null && montoNum >= LIMITES.capitalMin && montoNum <= LIMITES.capitalMax;
  const parametros = useDiferido(montoValido ? `${montoNormal}|${plazo}` : '', 350);

  const estimado = useCarga(async () => {
    if (!parametros) return null;
    const [capital, p] = parametros.split('|');
    return api.simularPlan({ capital: capital!, plazoMeses: Number(p), tnaBps: TNA_BPS, fechaDesembolso: s.fecha });
  }, [parametros, s.fecha]);

  const contexto = useCarga(async () => {
    if (!cliente) return null;
    const [creditos, solicitudes] = await Promise.all([api.creditos(s.fecha, { q: cliente.idCliente }), api.solicitudes()]);
    return {
      activo: creditos.creditos.find((c) => c.idCliente === cliente.idCliente && c.estado !== 'CANCELADO' && c.estado !== 'INCOBRABLE'),
      enCurso: solicitudes.find((x) => x.idCliente === cliente.idCliente && (x.estado === 'SOLICITADA' || x.estado === 'APROBADA')),
    };
  }, [cliente?.idCliente, s.fecha]);
  const enCurso = contexto.datos?.enCurso;

  const continuar = () => {
    const e: Record<string, string> = {};
    if (!cliente) e.cliente = 'Selecciona un cliente.';
    if (!montoValido) e.monto = 'El monto debe estar entre Q1,000.00 y Q25,000.00, con hasta dos decimales.';
    setError(e);
    if (Object.keys(e).length > 0) return;
    if (estimado.datos) simular(estimado.datos);
    else setFalla('Espera a que termine la simulación del plan.');
  };

  return (
    <Pantalla barra={<>
      <TopBar title="Nueva solicitud" onBack={volver} />
      <Cabecera>
        <button onClick={elegirCliente} aria-label="Cambiar cliente"
          className={`w-full flex items-center gap-3 bg-white/10 rounded-xl px-3 py-2.5 text-left active:bg-white/20 transition-colors ${FOCO}`}>
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 shrink-0">{Ico.user('white')}</span>
          {cliente ? (
            <span className="flex-1 min-w-0">
              <span className="block text-white text-sm font-semibold leading-tight">{cliente.nombreCompleto}</span>
              <span className="block text-slate-400 text-xs font-mono mt-0.5">{cliente.idCliente} · DPI {cliente.dpi}</span>
            </span>
          ) : (
            <span className="flex-1">
              <span className="block text-slate-300 text-sm font-semibold">Seleccionar cliente…</span>
              <span className="block text-slate-500 text-xs mt-0.5">Toca para elegir</span>
            </span>
          )}
          <span className="text-slate-400 shrink-0">{Ico.chevRight()}</span>
        </button>
        {error.cliente && <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1" role="alert">{Ico.alert('#f87171')} {error.cliente}</p>}
      </Cabecera>
    </>}>
      {enCurso && (
        <Alert type="warning">
          <strong>Solicitud en proceso ({enCurso.idSolicitud}).</strong> Este cliente ya tiene una solicitud {ETIQUETA_ESTADO[enCurso.estado]!.toLowerCase()}. No se puede crear otra hasta que sea desembolsada o rechazada.
        </Alert>
      )}
      {!enCurso && contexto.datos?.activo && (
        <Alert type="info"><strong>Crédito activo ({contexto.datos.activo.idCredito}).</strong> El cliente tiene saldo pendiente de {Q(contexto.datos.activo.saldoCapital)}.</Alert>
      )}

      <Field id="monto" label="Monto solicitado" hint="Rango permitido: Q1,000.00 – Q25,000.00" error={error.monto}>
        <input id="monto" inputMode="decimal" className={inputCls} value={monto} aria-invalid={Boolean(error.monto)}
          onChange={(e) => { setBorrador((b) => ({ ...b, monto: e.target.value })); setError((p) => ({ ...p, monto: '' })); }} />
      </Field>
      <Field id="plazo" label="Plazo de pago" hint="Entre 3 y 24 meses">
        <select id="plazo" className={inputCls} value={plazo} onChange={(e) => setBorrador((b) => ({ ...b, plazo: Number(e.target.value) }))}>
          {Array.from({ length: LIMITES.plazoMax - LIMITES.plazoMin + 1 }, (_, i) => i + LIMITES.plazoMin).map((m) => <option key={m} value={m}>{m} meses</option>)}
        </select>
      </Field>
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex flex-col gap-1">
        <p className="text-xs font-semibold text-slate-500">Tasa de interés aplicada</p>
        <p className="text-sm font-semibold text-[#0f172a]">{tasaMensual(TNA_BPS)} mensual · {tasaAnual(TNA_BPS)} nominal anual</p>
      </div>
      {montoValido && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4" aria-live="polite">
          <p className="text-xs font-semibold text-teal-700 mb-0.5">Cuota mensual estimada</p>
          <p className="text-3xl font-extrabold text-teal-700" style={DISPLAY}>{estimado.datos ? Q(estimado.datos.cuotas[0]!.pago) : '…'}</p>
          <p className="text-[11px] text-teal-600 mt-0.5">{Q(montoNormal)} · {plazo} cuotas · {tasaMensual(TNA_BPS)} mensual · calculada por el servidor</p>
        </div>
      )}
      {estimado.error !== undefined && <Alert type="error">{mensajeDeError(estimado.error)}</Alert>}
      {falla && <Alert type="error">{falla}</Alert>}
      <BtnPrimary label="Simular plan de pagos" onClick={continuar} disabled={Boolean(enCurso)} busy={estimado.cargando && montoValido && Boolean(cliente)} />
    </Pantalla>
  );
}

// ── Revisión y envío ─────────────────────────────────────────────────────
function Confirmar({ cliente, plan, volver, enviada, idAsesor }: {
  cliente: TCliente; plan: TPlanSimulado; volver: () => void; enviada: (s: TSolicitud) => void; idAsesor: string;
}) {
  const s = useSesion();
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState('');
  const enviar = async () => {
    setEnviando(true);
    setFalla('');
    try {
      const r = await api.crearSolicitud({ idCliente: cliente.idCliente, idAsesor, capital: plan.capital.valor, plazoMeses: plan.plazoMeses, tnaBps: plan.tnaBps, fecha: s.fecha });
      enviada(r.solicitud);
    } catch (err) {
      setFalla(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Pantalla barra={<TopBar title="Revisar solicitud" onBack={volver} />}>
      <Filas filas={[
        ['Cliente', cliente.nombreCompleto],
        ['DPI', <span className="font-mono">{cliente.dpi}</span>],
        ['Municipio', cliente.municipio],
        ['Monto', Q(plan.capital)],
        ['Plazo', `${plan.plazoMeses} meses`],
        ['Tasa', `${tasaMensual(plan.tnaBps)} mensual · ${tasaAnual(plan.tnaBps)} anual`],
        ['Cuota estimada', Q(plan.cuotas[0]!.pago)],
        ['Asesor', `${s.usuario} (${idAsesor})`],
        ['Fecha de solicitud', fecha(s.fecha)],
      ]} />
      <Alert type="warning">Revisa todos los datos. Una vez confirmada, la solicitud pasará al comité de crédito.</Alert>
      {falla && <Alert type="error">{falla}</Alert>}
      <div className="flex gap-3">
        <BtnSecondary label="Regresar y corregir" onClick={volver} />
        <BtnPrimary label="Confirmar solicitud" onClick={() => void enviar()} busy={enviando} />
      </div>
    </Pantalla>
  );
}
