#!/usr/bin/env node
/**
 * Ejecuta un archivo .sql contra la base configurada en priorizacion/.env,
 * usando el driver `pg` de la app. Existe porque psql no está instalado en
 * esta máquina.
 *
 * Uso:
 *   node scripts/ejecutar-sql.js scripts/crear-rol-app.sql
 *   node scripts/ejecutar-sql.js consulta.sql --mostrar   # imprime filas
 *
 * El archivo se envía completo en una sola llamada, que en el protocolo simple
 * de PostgreSQL se ejecuta dentro de una transacción implícita: si algo falla,
 * no queda nada a medias.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'priorizacion');
const { Pool } = createRequire(path.join(APP_DIR, 'package.json'))('pg');

const loadEnv = () => {
    const envPath = path.join(APP_DIR, '.env');
    if (!fs.existsSync(envPath)) throw new Error(`No se encontró ${envPath}.`);
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
        if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
};

const resolveSsl = (host) => {
    const mode = (process.env.PGSSLMODE || '').trim().toLowerCase();
    if (mode === 'disable') return false;
    if (mode) return { rejectUnauthorized: true };
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return local ? false : { rejectUnauthorized: true };
};

const main = async () => {
    const args = process.argv.slice(2);
    const mostrar = args.includes('--mostrar');
    const file = args.find((a) => !a.startsWith('--'));

    if (!file) {
        console.error('Uso: node scripts/ejecutar-sql.js <archivo.sql> [--mostrar]');
        process.exit(1);
    }
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    if (!fs.existsSync(abs)) throw new Error(`No existe el archivo ${abs}`);

    loadEnv();
    for (const k of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
        if (!process.env[k]) throw new Error(`Falta la variable ${k} en priorizacion/.env`);
    }

    const host = process.env.PGHOST;
    const ssl = resolveSsl(host);
    const pool = new Pool({
        host,
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl,
        max: 1,
        connectionTimeoutMillis: 20_000,
    });

    console.log(`${host}/${process.env.PGDATABASE} como ${process.env.PGUSER} (TLS: ${ssl ? 'sí' : 'no'})`);
    console.log(`Ejecutando ${path.basename(abs)} …`);

    const client = await pool.connect();
    try {
        // `pg` expone los RAISE NOTICE del servidor por este evento; sin él, los
        // mensajes informativos del script se perderían.
        client.on('notice', (n) => console.log(`  [${n.severity}] ${n.message}`));

        const res = await client.query(fs.readFileSync(abs, 'utf8'));
        const results = Array.isArray(res) ? res : [res];

        console.log(`  ✓ ${results.length} sentencia(s) con resultado.`);
        if (mostrar || results.some((r) => r.rows?.length)) {
            for (const r of results) {
                if (r.rows?.length) console.table(r.rows);
            }
        }
    } finally {
        client.release();
        await pool.end();
    }
};

main().catch((err) => {
    console.error('\n✗', err.message);
    if (err.code) console.error('  código PostgreSQL:', err.code);
    if (err.hint) console.error('  sugerencia:', err.hint);
    process.exit(1);
});
