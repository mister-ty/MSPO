// Cliente PostgreSQL del módulo. El esquema (tablas, índices, vistas) y la
// matriz semilla se gestionan por fuera del proyecto: ver `mpo.sql` en la raíz
// del repositorio, que se aplica con psql una única vez por entorno.
//
// Env vars (ver .env.example):
//   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
//   PGSSLMODE  (opcional) require | disable
//   PGPOOL_MAX (opcional) tamaño del pool

const { Pool } = require('pg');

let _pool = null;

// Sin valores por defecto a propósito: una variable ausente en producción debe
// fallar con un mensaje claro, no acabar conectando en silencio a un localhost
// que no existe en el entorno de despliegue.
const REQUIRED_ENV = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

const isLocalHost = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

// Azure Database for PostgreSQL exige TLS (require_secure_transport = ON) y
// `pg` no lo negocia si no se le indica. Un PostgreSQL local normalmente no lo
// ofrece, así que el host decide el valor por defecto y PGSSLMODE lo fuerza.
const resolveSsl = (host) => {
    const mode = (process.env.PGSSLMODE || '').trim().toLowerCase();
    if (mode === 'disable') return false;
    if (mode) return { rejectUnauthorized: true };
    return isLocalHost(host) ? false : { rejectUnauthorized: true };
};

const ensurePool = () => {
    if (_pool) return _pool;

    // La validación es perezosa (dentro de ensurePool, no al importar el módulo)
    // porque `next build` corre sin estas variables y no debe romperse.
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length) {
        throw new Error(
            `Configuración de base de datos incompleta: falta ${missing.join(', ')}. ` +
            'Ver .env.example para la lista completa de variables.',
        );
    }

    const host = process.env.PGHOST;

    _pool = new Pool({
        host,
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: resolveSsl(host),
        // Cada instancia serverless mantiene su propio pool, y el tier Burstable
        // B1ms de Azure sólo admite 35 conexiones de usuario sin acceso a
        // PgBouncer. De ahí el 1 por defecto. Contrapartida: dentro de una misma
        // instancia las peticiones concurrentes se serializan sobre esa única
        // conexión, así que si el flujo masivo empieza a dar timeouts de
        // adquisición, subir PGPOOL_MAX (vigilando el total contra las 35).
        max: Number(process.env.PGPOOL_MAX) || 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 8_000,
        allowExitOnIdle: true,
    });

    // Sin este listener, un error en un cliente idle del pool se convierte en
    // una excepción no capturada que tumba la función entera.
    _pool.on('error', (err) => {
        console.error('Error inesperado en cliente idle de PostgreSQL:', err.message);
    });

    return _pool;
};

// Convierte placeholders `?` (heredados del cliente SQLite anterior) a
// `$1, $2, …` (Postgres), en el orden en que aparecen. Ignora los `?` que
// forman parte de literales entre comillas simples o identificadores entre
// comillas dobles (p. ej. la columna "¿TIENE UBICACIÓN?").
const qMarkToPg = (sql) => {
    let out = '';
    let i = 0;
    let quote = null; // "'" o '"' mientras se recorre un literal/identificador
    for (const ch of sql) {
        if (quote) {
            if (ch === quote) quote = null;
            out += ch;
        } else if (ch === "'" || ch === '"') {
            quote = ch;
            out += ch;
        } else if (ch === '?') {
            out += `$${++i}`;
        } else {
            out += ch;
        }
    }
    return out;
};

const buildPool = () => ({
    query: async (sql, params = []) => {
        const pool = ensurePool();
        const r = await pool.query(qMarkToPg(sql), params);
        return { rows: r.rows, rowsAffected: r.rowCount };
    },
});

const getSiroPool = () => buildPool();
const getMspoPool = () => buildPool();

// Shim de transacción compatible con la API que usan los repositorios
// (client.transaction('write') -> {execute({sql, args}), commit(), rollback()}),
// para no reescribir saveFullTrace()/saveResults().
const getRawClient = () => ({
    transaction: async () => {
        const pool = ensurePool();
        const client = await pool.connect();
        await client.query('BEGIN');
        let closed = false;
        return {
            execute: async ({ sql, args }) => {
                const r = await client.query(qMarkToPg(sql), args);
                return { rows: r.rows, rowsAffected: r.rowCount };
            },
            commit: async () => {
                if (closed) return;
                closed = true;
                await client.query('COMMIT');
                client.release();
            },
            rollback: async () => {
                if (closed) return;
                closed = true;
                await client.query('ROLLBACK');
                client.release();
            },
        };
    },
});

module.exports = {
    getSiroPool,
    getMspoPool,
    getRawClient,
};
