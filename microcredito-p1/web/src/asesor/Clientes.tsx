import { useState } from 'react';
import { AltaClienteBody } from '../../../src/contratos/api';
import type { Ir } from '../App';
import { api, ErrorApi, mensajeDeError, type TCliente } from '../api';
import { ETIQUETA_ESTADO, ETIQUETA_TRAMO, Q, colorEstado, colorTramo, fecha, siguienteCodigo } from '../formato';
import { useSesion } from '../sesion';
import {
  Accion, Alert, Badge, BtnPrimary, BtnSecondary, Buscador, Cabecera, ConCarga, DISPLAY, Exito, FOCO, Field, Filas, Ico,
  Pantalla, Seccion, TopBar, inputCls, useCarga, useDiferido,
} from '../ui';

type Vista = { modo: 'buscar' } | { modo: 'detalle'; id: string } | { modo: 'alta' } | { modo: 'registrado'; cliente: TCliente };

export default function Clientes({ ir, idInicial }: { ir: Ir; idInicial?: string }) {
  const [vista, setVista] = useState<Vista>(idInicial ? { modo: 'detalle', id: idInicial } : { modo: 'buscar' });
  const volver = () => setVista({ modo: 'buscar' });

  if (vista.modo === 'detalle') return <DetalleCliente id={vista.id} ir={ir} volver={volver} />;
  if (vista.modo === 'alta') return <AltaCliente volver={volver} registrado={(cliente) => setVista({ modo: 'registrado', cliente })} />;
  if (vista.modo === 'registrado') {
    const c = vista.cliente;
    return (
      <Pantalla barra={<TopBar title="Cliente registrado" onBack={volver} />}>
        <Exito titulo="Cliente registrado correctamente.">
          <p className="text-slate-500 text-sm">{c.nombreCompleto}</p>
          <p className="text-slate-600 text-xs font-mono">{c.idCliente} · DPI {c.dpi} · {c.municipio}</p>
        </Exito>
        <Alert type="success">El alta quedó guardada en el servidor el {fecha(c.fechaAlta)}.</Alert>
        <BtnPrimary label="Crear solicitud de crédito" onClick={() => ir({ tab: 'solicitudes', idCliente: c.idCliente })} />
        <BtnSecondary label="Volver a Clientes" onClick={volver} />
      </Pantalla>
    );
  }
  return <BuscarClientes abrir={(id) => setVista({ modo: 'detalle', id })} alta={() => setVista({ modo: 'alta' })} ir={ir} />;
}

function BuscarClientes({ abrir, alta, ir }: { abrir: (id: string) => void; alta: () => void; ir: Ir }) {
  const [texto, setTexto] = useState('');
  const busqueda = useDiferido(texto.trim());
  const carga = useCarga(() => api.clientes(busqueda.length > 1 ? busqueda : undefined), [busqueda]);

  return (
    <Pantalla barra={<TopBar title="Clientes" onBack={() => ir({ tab: 'inicio' })} />}>
      <div>
        <label htmlFor="buscar-cliente" className="text-xs font-semibold text-slate-600 block mb-1.5">Buscar cliente</label>
        <Buscador id="buscar-cliente" value={texto} onChange={setTexto} placeholder="Nombre, DPI o código de cliente" />
      </div>
      <button onClick={alta}
        className={`w-full border-2 border-dashed border-slate-200 rounded-xl py-4 text-sm font-semibold text-slate-500 flex items-center justify-center gap-2 ${FOCO}`}>
        {Ico.userPlus('#64748b')} Registrar nuevo cliente
      </button>
      <ConCarga carga={carga}>
        {(clientes) => (
          <Seccion titulo={busqueda.length > 1 ? `${clientes.length} resultado${clientes.length === 1 ? '' : 's'}` : `${clientes.length} clientes`}>
            {clientes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-600 text-center bg-white rounded-xl border border-slate-200">Sin resultados para «{texto}».</p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {clientes.map((c) => (
                  <button key={c.idCliente} onClick={() => abrir(c.idCliente)}
                    className={`w-full flex items-center justify-between px-4 py-3.5 text-left active:bg-slate-50 ${FOCO}`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#0f172a]">{c.nombreCompleto}</span>
                      <span className="block text-xs text-slate-600 font-mono mt-0.5">{c.idCliente} · DPI {c.dpi}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{c.municipio}</span>
                    </span>
                    <span className="text-slate-400 shrink-0 ml-3">{Ico.chevRight()}</span>
                  </button>
                ))}
              </div>
            )}
          </Seccion>
        )}
      </ConCarga>
    </Pantalla>
  );
}

function DetalleCliente({ id, ir, volver }: { id: string; ir: Ir; volver: () => void }) {
  const s = useSesion();
  const carga = useCarga(async () => {
    const [clientes, creditos, solicitudes] = await Promise.all([api.clientes(id), api.creditos(s.fecha, { q: id }), api.solicitudes()]);
    const cliente = clientes.find((c) => c.idCliente === id);
    if (!cliente) throw new ErrorApi(404, { type: 'about:blank', title: 'Cliente inexistente', status: 404, codigo: 'ENTIDAD_INEXISTENTE', detail: `No existe el cliente ${id}` });
    return {
      cliente,
      creditos: creditos.creditos.filter((c) => c.idCliente === id),
      solicitudes: solicitudes.filter((x) => x.idCliente === id),
    };
  }, [id, s.fecha]);

  return (
    <ConCarga carga={carga}>
      {({ cliente: c, creditos, solicitudes }) => {
        const enCurso = solicitudes.find((x) => x.estado === 'SOLICITADA' || x.estado === 'APROBADA');
        const conAtraso = creditos.find((x) => x.diasAtraso > 0 && x.estado !== 'CANCELADO');
        return (
          <Pantalla barra={<><TopBar title="Detalle del cliente" onBack={volver} />
            <Cabecera>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-teal-400 flex items-center justify-center shrink-0">{Ico.user('#0f172a')}</div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-lg leading-tight" style={DISPLAY}>{c.nombreCompleto}</p>
                  <p className="text-slate-400 text-xs font-mono mt-0.5">{c.idCliente} · DPI {c.dpi}</p>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${conAtraso ? 'bg-red-400/20 text-red-300' : 'bg-emerald-400/20 text-emerald-300'}`}>
                    {conAtraso ? `${conAtraso.diasAtraso} días de atraso — ${ETIQUETA_TRAMO[conAtraso.tramo]}` : 'Sin atraso'}
                  </span>
                </div>
              </div>
            </Cabecera></>}>
            <Filas filas={[
              ['Nombre completo', c.nombreCompleto],
              ['Código de cliente', <span className="font-mono">{c.idCliente}</span>],
              ['DPI', <span className="font-mono">{c.dpi}</span>],
              ['Teléfono', c.telefono || '—'],
              ['Municipio', c.municipio],
              ['Fecha de alta', fecha(c.fechaAlta)],
            ]} />

            <Seccion titulo="Créditos">
              {creditos.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white rounded-2xl border border-slate-100 px-4 py-4 text-center">Sin créditos desembolsados.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {creditos.map((cr) => (
                    <button key={cr.idCredito} onClick={() => ir({ tab: 'creditos', idCredito: cr.idCredito })}
                      className={`w-full bg-white rounded-2xl border border-slate-100 p-4 text-left ${FOCO}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-xs text-slate-600">{cr.idCredito}</span>
                        <Badge label={cr.diasAtraso > 0 ? ETIQUETA_TRAMO[cr.tramo]! : ETIQUETA_ESTADO[cr.estado]!} color={cr.diasAtraso > 0 ? colorTramo(cr.tramo) : colorEstado(cr.estado)} />
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Saldo <span className="font-semibold text-[#0f172a]">{Q(cr.saldoCapital)}</span></span>
                        <span>Capital {Q(cr.capitalOriginal)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Seccion>

            {solicitudes.length > 0 && (
              <Seccion titulo="Solicitudes">
                <Filas filas={solicitudes.map((x) => [x.idSolicitud, <span className="flex items-center gap-2 justify-end">{Q(x.capital)} <Badge label={ETIQUETA_ESTADO[x.estado]!} color={colorEstado(x.estado)} /></span>])} />
              </Seccion>
            )}

            {enCurso && (
              <Alert type="warning">
                <strong>Solicitud en proceso ({enCurso.idSolicitud}).</strong> El cliente ya tiene una solicitud {ETIQUETA_ESTADO[enCurso.estado]!.toLowerCase()}.
                {enCurso.estado === 'APROBADA' && (
                  <button onClick={() => ir({ tab: 'solicitudes', desembolsar: enCurso.idSolicitud })} className={`block mt-2 font-semibold underline ${FOCO}`}>Continuar al desembolso →</button>
                )}
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              {creditos[0] && <Accion icon={Ico.creditCard('#0f172a')} label="Ver detalle del crédito" onClick={() => ir({ tab: 'creditos', idCredito: creditos[0]!.idCredito })} />}
              <BtnPrimary label="Nueva solicitud" disabled={Boolean(enCurso)} onClick={() => ir({ tab: 'solicitudes', idCliente: c.idCliente })} />
              <BtnSecondary label="Regresar" onClick={volver} />
            </div>
          </Pantalla>
        );
      }}
    </ConCarga>
  );
}

export function AltaCliente({ volver, registrado }: { volver: () => void; registrado: (c: TCliente) => void }) {
  const s = useSesion();
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [dpi, setDpi] = useState('');
  const [tel, setTel] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState('');

  const validar = () => {
    const e: Record<string, string> = {};
    if (codigo.trim() && !AltaClienteBody.shape.idCliente.safeParse(codigo.trim()).success) e.codigo = 'El código debe tener el formato CL-0000.';
    if (nombre.trim().length < 3) e.nombre = 'Ingresa el nombre completo (mínimo 3 letras).';
    const identificacion = dpi.trim();
    const dpiNormal = /^\d{13}$/.test(identificacion.replace(/\s/g, ''));
    const dpiDemostracion = /^DPI-FICT-\d{6}$/.test(identificacion);
    if (!dpiNormal && !dpiDemostracion) e.dpi = 'El DPI debe tener 13 dígitos o el formato ficticio DPI-FICT-000000 para demostración.';
    if (tel.trim().length > 20) e.tel = 'Máximo 20 caracteres.';
    if (municipio.trim().length < 2) e.municipio = 'Ingresa el municipio.';
    return e;
  };

  const guardar = async () => {
    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return;
    setEnviando(true);
    setFalla('');
    try {
      // Conserva el correlativo automático cuando no se indica un código; el servidor valida duplicados.
      const idCliente = codigo.trim() || siguienteCodigo('CL-', (await api.clientes()).map((c) => c.idCliente));
      const cliente = await api.registrarCliente({
        idCliente,
        nombreCompleto: nombre.trim(),
        dpi: dpi.replace(/\s/g, ''),
        ...(tel.trim() ? { telefono: tel.trim() } : {}),
        municipio: municipio.trim(),
        fechaAlta: s.fecha,
      });
      registrado(cliente);
    } catch (err) {
      setFalla(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const limpiar = (campo: string) => setErrores((p) => ({ ...p, [campo]: '' }));
  return (
    <Pantalla barra={<TopBar title="Registrar cliente" onBack={volver} />}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void guardar(); }} noValidate>
        <Field id="codigo-cliente" label="Código de cliente (opcional)" hint="Formato CL-0000. Déjalo vacío para asignar el siguiente correlativo al guardar." error={errores.codigo}>
          <input id="codigo-cliente" className={`${inputCls} font-mono`} placeholder="Ej. CL-9001" value={codigo} maxLength={7}
            onChange={(e) => { setCodigo(e.target.value.toUpperCase()); limpiar('codigo'); }} aria-invalid={Boolean(errores.codigo)} />
        </Field>
        <Field id="nombre" label="Nombre completo" error={errores.nombre}>
          <input id="nombre" className={inputCls} placeholder="Ej. Carmen López Torres" value={nombre} autoComplete="off"
            onChange={(e) => { setNombre(e.target.value); limpiar('nombre'); }} aria-invalid={Boolean(errores.nombre)} />
        </Field>
        <Field id="dpi" label="DPI" hint="13 dígitos. Para demostración: DPI-FICT- seguido de 6 dígitos (ej. DPI-FICT-009001)." error={errores.dpi}>
          <input id="dpi" className={inputCls} placeholder="2598 11234 0101" value={dpi} maxLength={16}
            onChange={(e) => { setDpi(e.target.value); limpiar('dpi'); }} aria-invalid={Boolean(errores.dpi)} />
        </Field>
        <Field id="tel" label="Número de teléfono (opcional)" hint="Celular donde contactar al cliente" error={errores.tel}>
          <input id="tel" className={inputCls} placeholder="Ej. 5555 4787" value={tel} inputMode="tel"
            onChange={(e) => { setTel(e.target.value); limpiar('tel'); }} />
        </Field>
        <Field id="municipio" label="Municipio" error={errores.municipio}>
          <input id="municipio" className={inputCls} placeholder="Ej. Cobán" value={municipio}
            onChange={(e) => { setMunicipio(e.target.value); limpiar('municipio'); }} aria-invalid={Boolean(errores.municipio)} />
        </Field>
        <p className="text-[11px] text-slate-500">Fecha de alta: {fecha(s.fecha)} (fecha de operación). Si no indicas un código, se asigna al guardar.</p>
        {falla && <Alert type="error">{falla}</Alert>}
        <div className="flex gap-3 mt-1">
          <BtnSecondary label="Cancelar" onClick={volver} />
          <BtnPrimary type="submit" label="Guardar cliente" busy={enviando} />
        </div>
      </form>
    </Pantalla>
  );
}
