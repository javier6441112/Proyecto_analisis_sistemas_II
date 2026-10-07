import { resolve } from 'node:path';
import { abrirBaseDatos } from './base-datos.js';
import { cargarCanonico } from './carga-canonica.js';

async function main(): Promise<void> {
 const ruta = process.env.CV_DATA_DIR;
 if(!ruta) throw new Error('Define CV_DATA_DIR con la carpeta del paquete canónico');
 const db = await abrirBaseDatos(resolve(process.env.CV_DB_DIR ?? '.cv-db'));
 try {
  const resultado = await cargarCanonico(db,resolve(ruta));
  console.log(`\x1b[32mSHA-256 verificado: ${resultado.huella}\x1b[0m`);
  console.log(resultado.reutilizada?'Carga ya registrada: sin duplicados.':'Carga canónica completada.');
  console.table(resultado.conteos);
  const efectivos = await db.query<{aplicados:number;ignorados:number}>(
   "SELECT count(*) FILTER (WHERE aplicado)::int AS aplicados, count(*) FILTER (WHERE NOT aplicado)::int AS ignorados FROM pagos WHERE carga_id=$1",
   ['CV-PF-2026-10-31']);
  console.table(efectivos.rows);
 } finally {await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
