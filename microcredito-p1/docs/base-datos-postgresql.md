# Base de datos relacional en PostgreSQL / Amazon RDS

La aplicación usa PGlite: el motor PostgreSQL compilado a WebAssembly, que guarda la base en `.cv-db` y no necesita un servidor. Para revisar los datos en un PostgreSQL convencional (por ejemplo, una instancia de Amazon RDS para pruebas), la base se exporta a un script SQL estándar.

## Qué contiene el script

`npm run db:exportar` genera `db/postgres/microcredito.sql`. El esquema **no se escribe a mano**: se lee del catálogo de la propia base (`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef`, `pg_get_functiondef`). Por eso el script siempre coincide con las tablas que usa la aplicación.

El script se ejecuta en una sola transacción y sigue este orden:

1. borra y vuelve a crear el esquema `microcredito` (`DROP SCHEMA … CASCADE`); no toca ningún otro esquema;
2. crea las 17 tablas con sus columnas, claves primarias, `UNIQUE` y `CHECK`;
3. inserta los datos y reinicia las secuencias (`serial` e `identity`);
4. agrega las claves foráneas, los índices, las funciones y los triggers que impiden modificar los registros contables.

Las claves foráneas y los triggers se crean después de los datos. Así el orden de carga no depende de las relaciones entre tablas, y los triggers no bloquean la carga. Ejecutar el script otra vez da el mismo resultado.

El script incluye la tabla `usuarios` con los hashes scrypt de las claves (nunca las claves en claro). Por eso `db/postgres/*.sql` está en `.gitignore`.

## Modelo entidad-relación

```mermaid
erDiagram
  cargas_canonicas ||--o{ clientes : "carga_id"
  cargas_canonicas ||--o{ creditos : "carga_id"
  cargas_canonicas ||--o{ pagos : "carga_id"
  cargas_canonicas ||--o{ eventos_canonicos : "carga_id"
  asesores ||--o{ creditos : "id_asesor"
  asesores |o--o| usuarios : "id_asesor (rol asesor)"
  clientes ||--o{ creditos : "id_cliente"
  creditos ||--o{ pagos : "id_credito"
  documentos_rag ||--o{ fragmentos_rag : "doc_id"

  usuarios {
    text usuario PK
    text nombre_completo
    text rol "asesor | gerente"
    text id_asesor FK "UNIQUE; obligatorio solo si rol = asesor"
    text clave_hash "scrypt$sal$hash"
    boolean activo
  }
  asesores { text id_asesor PK
    text nombre_completo }
  clientes { text id_cliente PK
    text nombre_completo
    text dpi "UNIQUE"
    text telefono
    text municipio
    date fecha_alta }
  creditos { text id_credito PK
    text id_cliente FK
    text id_asesor FK
    date fecha
    bigint capital_centavos
    int plazo_meses
    int tna_bps
    boolean reestructurado }
  pagos { bigint id PK
    int seq_canonica "UNIQUE"
    text clave_idempotencia
    boolean aplicado
    text id_credito FK
    date fecha
    bigint monto_centavos
    text canal }
  cargas_canonicas { text id PK
    text huella_eventos
    jsonb manifiesto }
  eventos_canonicos { int seq PK
    text tipo
    jsonb contenido }
  documentos_rag { text doc_id PK
    text nombre_archivo
    text sha256 }
  fragmentos_rag { text id PK
    text doc_id FK
    text seccion
    vector embedding }
```

Las demás tablas no tienen claves foráneas, porque guardan hechos que se agregan y no se modifican:

| Tabla | Contenido |
|---|---|
| `bitacora_operaciones` | Operaciones de la interfaz (altas, solicitudes, comité, desembolsos, pagos) con usuario y aprobador; `clave` UNIQUE garantiza la idempotencia |
| `parametros_politicas` | Parámetros de mora vigentes (JSONB) |
| `cierres_ejecutados` | Cierre definitivo por período, congelado (ADR-003) |
| `aperturas_provisiones`, `movimientos_provisiones` | Registro acumulativo de reservas (inmutable por trigger) |
| `aperturas_devengo`, `movimientos_devengo`, `cortes_devengo` | Devengo corriente (inmutable por trigger) |

## Publicar en Amazon RDS

1. En la consola de AWS → RDS → *Crear base de datos*: motor **PostgreSQL 15 o superior** (pgvector viene incluido), plantilla *Capa gratuita* o *Desarrollo/pruebas*, nombre de base inicial `microcredito`.
2. En *Conectividad*: si va a publicar desde su computadora, active *Acceso público* y, en el grupo de seguridad, permita el puerto 5432 **solo desde su IP**.
3. Con la API detenida (PGlite admite un solo proceso):

```powershell
$env:CV_POSTGRES_URL = 'postgres://postgres:SU_CLAVE@mi-base.xxxx.us-east-1.rds.amazonaws.com:5432/microcredito'
# Opcional, para verificar el certificado TLS de RDS:
# $env:CV_POSTGRES_CA = 'C:\ruta\global-bundle.pem'   (https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem)
npm run db:publicar
```

Al terminar, el comando muestra el número de filas de cada tabla en RDS. Si `CV_POSTGRES_CA` no está definida, la conexión a un host remoto usa TLS sin verificar el certificado. Sirve para pruebas, pero no para producción.

4. Para revisar los datos, conéctese con pgAdmin, DBeaver o `psql` y consulte el esquema `microcredito`:

```sql
SET search_path = microcredito, public;
SELECT rol, count(*) FROM usuarios GROUP BY rol;
SELECT c.id_credito, cl.nombre_completo, a.nombre_completo AS asesor, c.capital_centavos / 100.0 AS capital
FROM creditos c JOIN clientes cl USING (id_cliente) JOIN asesores a USING (id_asesor)
ORDER BY c.id_credito;
```

Otra opción es ejecutar el archivo directamente: `psql "$env:CV_POSTGRES_URL" -f db/postgres/microcredito.sql`.

## Opciones

| Opción | Efecto |
|---|---|
| `--sin-rag` | Omite `documentos_rag`, `fragmentos_rag` y `CREATE EXTENSION vector` (para un PostgreSQL sin pgvector) |
| `--esquema nombre` | Usa otro esquema destino en lugar de `microcredito` |
| `--salida archivo` | Ruta del script (solo `db:exportar`) |

Ejemplo: `npm run db:exportar -- --sin-rag --esquema pruebas`.

## Alcance

RDS recibe una **copia** de la base local. La aplicación sigue leyendo y escribiendo en `.cv-db`. Después de operar en la interfaz, repita `npm run db:publicar` para actualizar la copia en RDS.

## Verificación

`tests/usuarios-postgres.test.ts` exporta una copia de la base y ejecuta el script en un PostgreSQL nuevo en memoria. La prueba comprueba que:

- las filas de cada tabla coinciden con el origen;
- las claves foráneas rechazan referencias inválidas;
- los triggers de inmutabilidad existen;
- ejecutar el script una segunda vez da el mismo resultado.
