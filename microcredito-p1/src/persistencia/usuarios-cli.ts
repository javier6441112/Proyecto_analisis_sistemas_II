/**
 * Administración de usuarios: `npm run usuarios -- <comando>` (con la API detenida, porque
 * PGlite admite un solo proceso sobre `.cv-db`).
 *
 *   listar
 *   clave    <usuario> <clave-nueva>
 *   agregar  <usuario> <gerente|asesor> "<Nombre completo>" <clave> [AS-NN]
 *   activar  <usuario>
 *   desactivar <usuario>
 */
import { abrirBaseLocal } from './adaptador-nucleo.js';
import { agregarUsuario, asegurarUsuarios, cambiarClave, fijarActivo, type Rol } from './usuarios.js';

async function main(): Promise<void> {
  const [comando, ...args] = process.argv.slice(2);
  const db = await abrirBaseLocal();
  try {
    await asegurarUsuarios(db);
    switch (comando) {
      case undefined:
      case 'listar': {
        const r = await db.query<Record<string, unknown>>('SELECT usuario, nombre_completo, rol, id_asesor, activo FROM usuarios ORDER BY rol DESC, usuario');
        console.table(r.rows);
        return;
      }
      case 'clave': {
        const [usuario, clave] = args;
        if (!usuario || !clave) throw new Error('Uso: clave <usuario> <clave-nueva>');
        if (!(await cambiarClave(db, usuario, clave))) throw new Error(`No existe el usuario ${usuario}`);
        console.log(`Clave de ${usuario} actualizada.`);
        return;
      }
      case 'agregar': {
        const [usuario, rol, nombreCompleto, clave, idAsesor] = args;
        if (!usuario || (rol !== 'gerente' && rol !== 'asesor') || !nombreCompleto || !clave) {
          throw new Error('Uso: agregar <usuario> <gerente|asesor> "<Nombre completo>" <clave> [AS-NN]');
        }
        if (rol === 'asesor' && !idAsesor) throw new Error('Un usuario asesor debe indicar su código AS-NN');
        await agregarUsuario(db, { usuario, rol: rol as Rol, nombreCompleto, idAsesor: rol === 'asesor' ? idAsesor! : null }, clave);
        console.log(`Usuario ${usuario} (${rol}) creado.`);
        return;
      }
      case 'activar':
      case 'desactivar': {
        const [usuario] = args;
        if (!usuario) throw new Error(`Uso: ${comando} <usuario>`);
        if (!(await fijarActivo(db, usuario, comando === 'activar'))) throw new Error(`No existe el usuario ${usuario}`);
        console.log(`Usuario ${usuario} ${comando === 'activar' ? 'activado' : 'desactivado'}.`);
        return;
      }
      default:
        throw new Error(`Comando desconocido: ${comando}. Use listar | clave | agregar | activar | desactivar`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
