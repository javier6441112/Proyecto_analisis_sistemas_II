import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { abrirBaseDatos, ESQUEMA } from '../src/persistencia/base-datos.js';
import { cargarCanonico, conteosCarga } from '../src/persistencia/carga-canonica.js';
import { sha256, leerPaquete } from '../src/persistencia/paquete.js';

const ruta=resolve('datos/datos-proyecto-final');
let db:PGlite;
let temporal:string;
beforeAll(async()=>{db=await abrirBaseDatos();temporal=await mkdtemp(join(tmpdir(),'cv-carga-'));},30000);
afterAll(async()=>{await db.close();await rm(temporal,{recursive:true,force:true});},30000);
async function copia(nombre:string) {
 const destino=join(temporal,nombre);await cp(ruta,destino,{recursive:true});return destino;
}
describe('E2: carga canónica',()=>{
 it('carga exacta y conservación de centavos, tasas, política y corpus',async()=>{
  const r=await cargarCanonico(db,ruta);
  expect(r.reutilizada).toBe(false);
  const efectivos=await db.query<{n:number}>('SELECT count(*)::int n FROM pagos WHERE aplicado');
  expect(efectivos.rows[0].n).toBe(226);
  expect(r.conteos).toEqual({clientes:60,creditos:75,pagos:228,eventos:363});
  expect(r.huella).toBe('e2d46283de8578f19ea2eb14ace283573ebb729aaa0e9b0e65f80a348e4b9d50');
  const p=await leerPaquete(ruta);
  const e=p.eventos.find(e=>e.tipo==='DESEMBOLSO')!;
  if(e.tipo!=='DESEMBOLSO') throw new Error('Fixture inválida');
  const credito=await db.query<{capital:string;tna_bps:number;reestructurado:boolean}>(
   'SELECT capital_centavos::text AS capital,tna_bps,reestructurado FROM creditos WHERE id_credito=$1',[e.id_credito]);
  expect(credito.rows[0]).toEqual({capital:String(e.capital_centavos),tna_bps:e.tna_bps,reestructurado:e.reestructurado});
  const docs=await db.query<{n:number}>('SELECT count(*)::int n FROM documentos_rag');expect(docs.rows[0].n).toBe(7);
  const nota=await db.query<{contenido:string}>('SELECT contenido FROM documentos_rag WHERE doc_id=$1',['NOTA-CAMPO-07']);
  expect(nota.rows[0].contenido).toBe(p.documentos.find(d=>d.docId==='NOTA-CAMPO-07')!.contenido);
 },30000);
 it('segunda carga no duplica ni borra operaciones nuevas',async()=>{
  await db.query(`INSERT INTO clientes VALUES('CL-PRUEBA','Cliente nuevo','DPI-PRUEBA','5555','Guatemala','2026-10-31',NULL)`);
  const r=await cargarCanonico(db,ruta);expect(r.reutilizada).toBe(true);
  expect(await conteosCarga(db)).toEqual({clientes:60,creditos:75,pagos:228,eventos:363});
  const total=await db.query<{n:number}>('SELECT count(*)::int n FROM clientes');expect(total.rows[0].n).toBe(61);
 },30000);
 it('rechaza huella alterada y deja intacta la cartera',async()=>{
  const dir=await copia('huella');await writeFile(join(dir,'eventos.jsonl'),'alterado');
  await expect(cargarCanonico(db,dir)).rejects.toThrow(/SHA-256/);
  expect((await conteosCarga(db)).pagos).toBe(228);
 });
 it('rechaza cambios en políticas de un paquete ya cargado',async()=>{
  const dir=await copia('politicas');const f=join(dir,'politicas.json');
  const datos=JSON.parse(await readFile(f,'utf8'));datos.gasto_gestion_cobro.monto_centavos=3000;
  await writeFile(f,JSON.stringify(datos));await expect(cargarCanonico(db,dir)).rejects.toThrow(/paquete cambió/);
 });
 it('rollback completo ante una referencia inválida',async()=>{
  const dir=await copia('referencia');const f=join(dir,'eventos.jsonl');
  const lines=(await readFile(f,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  lines.find(e=>e.tipo==='DESEMBOLSO').id_cliente='NO-EXISTE';
  const contenido=lines.map(e=>JSON.stringify(e)).join('\n')+'\n';await writeFile(f,contenido);
  await writeFile(join(dir,'eventos.sha256'),sha256(contenido)+'  eventos.jsonl\n');
  const otra=await abrirBaseDatos();
  try {
   await otra.exec(ESQUEMA);
   await expect(cargarCanonico(otra,dir)).rejects.toThrow();
   const r=await otra.query<{n:number}>('SELECT count(*)::int n FROM clientes');expect(r.rows[0].n).toBe(0);
   const cargas=await otra.query<{n:number}>('SELECT count(*)::int n FROM cargas_canonicas');expect(cargas.rows[0].n).toBe(0);
  } finally{await otra.close();}
 },30000);
 it('pgvector funciona y guarda vectores junto a documentos',async()=>{
  await db.query(`INSERT INTO fragmentos_rag VALUES('TEST-VECTOR','POL-2024-01','prueba','fragmento de prueba','test','[1,0,0]')`);
  const r=await db.query<{distancia:number}>("SELECT (embedding <=> '[1,0,0]'::vector)::float8 distancia FROM fragmentos_rag WHERE id='TEST-VECTOR'");
  expect(r.rows[0].distancia).toBe(0);
  await db.query("DELETE FROM fragmentos_rag WHERE id='TEST-VECTOR'");
 });
 it('persistencia real después de cerrar y reabrir',async()=>{
  const dataDir=join(temporal,'base');const primera=await abrirBaseDatos(dataDir);
  try {await cargarCanonico(primera,ruta);}finally{await primera.close();}
  const segunda=await abrirBaseDatos(dataDir);
  try {expect((await cargarCanonico(segunda,ruta)).reutilizada).toBe(true);}
  finally {await segunda.close();}
 },30000);
});
