import type { PGlite, Transaction } from '@electric-sql/pglite';
import { ESQUEMA } from './base-datos.js';
import { ID_CARGA, leerPaquete } from './paquete.js';

export async function conteosCarga(db: PGlite | Transaction) {
 const r = await db.query<{clientes:number;creditos:number;pagos:number;eventos:number}>(`
 SELECT (SELECT count(*)::int FROM clientes WHERE carga_id=$1) AS clientes,
 (SELECT count(*)::int FROM creditos WHERE carga_id=$1) AS creditos,
 (SELECT count(*)::int FROM pagos WHERE carga_id=$1) AS pagos,
 (SELECT count(*)::int FROM eventos_canonicos WHERE carga_id=$1) AS eventos`,[ID_CARGA]);
 return r.rows[0];
}
function validarConteos(c: Awaited<ReturnType<typeof conteosCarga>>): void {
 if(c.clientes!==60 || c.creditos!==75 || c.pagos!==228 || c.eventos!==363)
  throw new Error('La carga no produjo los conteos canónicos esperados');
}

export async function cargarCanonico(db: PGlite, ruta: string) {
 const paquete = await leerPaquete(ruta);
 return db.transaction(async tx=>{
  await tx.exec(ESQUEMA);
  const anterior = await tx.query<{manifiesto:unknown}>('SELECT manifiesto FROM cargas_canonicas WHERE id=$1',[ID_CARGA]);
  if(anterior.rows.length) {
   // jsonb no conserva orden de claves: comparar como valores, no strings serializados.
   const iguales = await tx.query<{igual:boolean}>('SELECT manifiesto = $2::jsonb AS igual FROM cargas_canonicas WHERE id=$1',
    [ID_CARGA,JSON.stringify(paquete.manifiesto)]);
   if(!iguales.rows[0].igual) throw new Error('El paquete cambió respecto de la carga registrada');
   const conteos=await conteosCarga(tx);validarConteos(conteos);
   return {huella:paquete.huella,reutilizada:true,conteos};
  }
  const previo = await tx.query<{cantidad:number}>(`SELECT
   ((SELECT count(*) FROM clientes)+(SELECT count(*) FROM creditos)+(SELECT count(*) FROM pagos))::int AS cantidad`);
  if(previo.rows[0].cantidad!==0) throw new Error('La primera carga requiere cartera vacía');
  await tx.query('INSERT INTO cargas_canonicas VALUES($1,$2,$3::jsonb)',
   [ID_CARGA,paquete.huella,JSON.stringify(paquete.manifiesto)]);
  for(const a of paquete.asesores) await tx.query('INSERT INTO asesores VALUES($1,$2)',[a.id_asesor,a.nombre_completo]);
  await tx.query('INSERT INTO parametros_politicas VALUES($1,$2::jsonb)', ['canonicas',JSON.stringify(paquete.politicas)]);
  const pagosVistos = new Map<string, string>();
  for(const e of paquete.eventos) {
   if(e.tipo==='CLIENTE') await tx.query('INSERT INTO clientes VALUES($1,$2,$3,$4,$5,$6,$7)',
    [e.id_cliente,e.nombre_completo,e.dpi,e.telefono,e.municipio,e.fecha_alta,ID_CARGA]);
   else if(e.tipo==='DESEMBOLSO') await tx.query('INSERT INTO creditos VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [e.id_credito,e.id_cliente,e.id_asesor,e.fecha,e.capital_centavos,e.plazo_meses,e.tna_bps,e.reestructurado,ID_CARGA]);
   else {
    const firma = JSON.stringify([e.id_credito,e.fecha,e.monto_centavos,e.canal]);
    const previo = pagosVistos.get(e.clave_idempotencia);
    if(previo !== undefined && previo !== firma) throw new Error('Clave de pago repetida con datos distintos');
    await tx.query(`INSERT INTO pagos(seq_canonica,clave_idempotencia,aplicado,id_credito,fecha,monto_centavos,canal,carga_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
     [e.seq,e.clave_idempotencia,previo===undefined,e.id_credito,e.fecha,e.monto_centavos,e.canal,ID_CARGA]);
    pagosVistos.set(e.clave_idempotencia,firma);
   }
   await tx.query('INSERT INTO eventos_canonicos VALUES($1,$2,$3::jsonb,$4)',[e.seq,e.tipo,JSON.stringify(e),ID_CARGA]);
  }
  for(const d of paquete.documentos) await tx.query('INSERT INTO documentos_rag VALUES($1,$2,$3,$4)',
   [d.docId,d.nombre,d.contenido,d.huella]);
  const conteos=await conteosCarga(tx);validarConteos(conteos);
  return {huella:paquete.huella,reutilizada:false,conteos};
 });
}
