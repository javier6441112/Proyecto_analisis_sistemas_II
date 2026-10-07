import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

export async function abrirBaseDatos(ruta: string = 'memory://'): Promise<PGlite> {
  return PGlite.create({ dataDir: ruta, extensions: { vector } });
}

export const ESQUEMA = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS cargas_canonicas (
 id text PRIMARY KEY, huella_eventos text NOT NULL, manifiesto jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS asesores (
 id_asesor text PRIMARY KEY, nombre_completo text NOT NULL
);
CREATE TABLE IF NOT EXISTS clientes (
 id_cliente text PRIMARY KEY, nombre_completo text NOT NULL, dpi text NOT NULL UNIQUE,
 telefono text NOT NULL, municipio text NOT NULL, fecha_alta date NOT NULL,
 carga_id text REFERENCES cargas_canonicas(id)
);
CREATE TABLE IF NOT EXISTS creditos (
 id_credito text PRIMARY KEY, id_cliente text NOT NULL REFERENCES clientes(id_cliente),
 id_asesor text NOT NULL REFERENCES asesores(id_asesor), fecha date NOT NULL,
 capital_centavos bigint NOT NULL CHECK(capital_centavos > 0),
 plazo_meses integer NOT NULL CHECK(plazo_meses > 0),
 tna_bps integer NOT NULL CHECK(tna_bps >= 0), reestructurado boolean NOT NULL,
 carga_id text REFERENCES cargas_canonicas(id)
);
CREATE TABLE IF NOT EXISTS pagos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 seq_canonica integer UNIQUE, clave_idempotencia text NOT NULL, aplicado boolean NOT NULL, id_credito text NOT NULL REFERENCES creditos(id_credito),
 fecha date NOT NULL, monto_centavos bigint NOT NULL CHECK(monto_centavos > 0), canal text NOT NULL,
 carga_id text REFERENCES cargas_canonicas(id)
);
CREATE TABLE IF NOT EXISTS eventos_canonicos (
 seq integer PRIMARY KEY, tipo text NOT NULL, contenido jsonb NOT NULL,
 carga_id text NOT NULL REFERENCES cargas_canonicas(id)
);
CREATE TABLE IF NOT EXISTS parametros_politicas (
 id text PRIMARY KEY, contenido jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS documentos_rag (
 doc_id text PRIMARY KEY, nombre_archivo text NOT NULL, contenido text NOT NULL, sha256 text NOT NULL
);
CREATE TABLE IF NOT EXISTS fragmentos_rag (
 id text PRIMARY KEY, doc_id text NOT NULL REFERENCES documentos_rag(doc_id),
 seccion text NOT NULL, contenido text NOT NULL, modelo_embedding text NOT NULL,
 embedding vector NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pagos_clave_aplicada ON pagos(clave_idempotencia) WHERE aplicado;
CREATE INDEX IF NOT EXISTS pagos_credito_fecha ON pagos(id_credito, fecha);
CREATE INDEX IF NOT EXISTS creditos_cliente ON creditos(id_cliente);
`;
