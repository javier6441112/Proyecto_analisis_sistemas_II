import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Fecha inexistente');
const id = z.string().min(1);
const entero = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positivo = entero.refine(n => n > 0);
const cliente = z.object({seq: positivo, tipo:z.literal('CLIENTE'), id_cliente:id,
 nombre_completo:id, dpi:id, telefono:id, municipio:id, fecha_alta:fecha});
const credito = z.object({seq:positivo, tipo:z.literal('DESEMBOLSO'),id_credito:id,
 id_cliente:id,id_asesor:id,fecha,capital_centavos:positivo,plazo_meses:positivo,
 tna_bps:entero,reestructurado:z.boolean()});
const pago = z.object({seq:positivo,tipo:z.literal('PAGO'),clave_idempotencia:id,
 id_credito:id,fecha,monto_centavos:positivo,canal:id});
const evento = z.discriminatedUnion('tipo',[cliente,credito,pago]);
export type EventoCanonico = z.infer<typeof evento>;
export const ID_CARGA = 'CV-PF-2026-10-31';
export function sha256(bytes: Uint8Array | string): string {
 return createHash('sha256').update(bytes).digest('hex');
}

export async function leerPaquete(ruta: string) {
 // La huella se verifica ANTES de analizar o insertar datos.
 const bytes = await readFile(join(ruta,'eventos.jsonl'));
 const huella = sha256(bytes);
 const archivoHuella = (await readFile(join(ruta,'eventos.sha256'),'utf8')).trim();
 const match = /^([a-fA-F0-9]{64})(?:\s+\*?eventos\.jsonl)?$/.exec(archivoHuella);
 if (!match || match[1].toLowerCase() !== huella) throw new Error('SHA-256 incorrecto: carga detenida');
 const eventos = bytes.toString('utf8').split(/\r?\n/).filter(l=>l.trim()).map(l=>evento.parse(JSON.parse(l)));
 eventos.forEach((e,i)=>{if(e.seq !== i+1) throw new Error('Secuencia canónica inválida');});
 const cantidades = {
  clientes:eventos.filter(e=>e.tipo==='CLIENTE').length,
  creditos:eventos.filter(e=>e.tipo==='DESEMBOLSO').length,
  pagos:eventos.filter(e=>e.tipo==='PAGO').length,
 };
 if(eventos.length!==363 || cantidades.clientes!==60 || cantidades.creditos!==75 || cantidades.pagos!==228)
  throw new Error('Conteos del paquete incorrectos');
 const asesoresBytes = await readFile(join(ruta,'asesores.csv'));
 const asesores = z.array(z.object({id_asesor:id,nombre_completo:id})).parse(
  parse(asesoresBytes,{columns:true,skip_empty_lines:true,bom:true}));
 if(asesores.length!==6 || new Set(asesores.map(a=>a.id_asesor)).size!==6) throw new Error('Catálogo de asesores inválido');
 const politicasBytes = await readFile(join(ruta,'politicas.json'));
 const politicas = z.object({version:id,moneda:z.literal('GTQ'),base_conteo:z.literal('Actual/360'),
  politicas_mora:z.record(z.string(),z.object({nombre:id,tipo:z.enum(['plana','escalonada'])}).passthrough()),
  gasto_gestion_cobro:z.object({monto_centavos:entero,dia_generacion:positivo,aplica_a_politicas:z.array(id)}).passthrough(),
  regla_incobrable_dias:positivo,regla_riesgo_dias:positivo}).passthrough().parse(JSON.parse(politicasBytes.toString('utf8')));
 const nombres = (await readdir(join(ruta,'corpus'))).filter(n=>n.endsWith('.md')).sort();
 if(nombres.length!==7) throw new Error('Se requieren siete documentos del corpus');
 const documentos = await Promise.all(nombres.map(async nombre=>{
  const contenido = await readFile(join(ruta,'corpus',nombre),'utf8');
  const docId = /^doc_id:\s*(\S+)\s*$/m.exec(contenido)?.[1];
  if(!docId) throw new Error(`Documento sin doc_id: ${nombre}`);
  return {docId,nombre,contenido,huella:sha256(contenido)};
 }));
 if(new Set(documentos.map(d=>d.docId)).size!==7) throw new Error('doc_id repetido');
 const manifiesto = {eventos:huella,asesores:sha256(asesoresBytes),politicas:sha256(politicasBytes),
  corpus:documentos.map(d=>({nombre:d.nombre,huella:d.huella}))};
 return {huella,eventos,asesores,politicas,documentos,manifiesto};
}
