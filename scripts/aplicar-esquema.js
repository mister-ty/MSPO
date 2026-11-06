#!/usr/bin/env node
/**
 * Aplica `mpo.sql` (esquema) y `scripts/matriz-mantenimiento-2026.sql` (matriz
 * activa) contra la base configurada en priorizacion/.env.
 *
 * Por qué no usa psql: no está instalado en esta máquina, y el driver `pg` que
 * ya trae la app puede ejecutar los archivos completos. `query()` sin parámetros
 * usa el protocolo simple, que admite varias sentencias separadas por `;` y las
 * envuelve en una transacción implícita.
 *
 * Re-ejecutable a propósito: ambos archivos son idempotentes.
 *
 * Uso:
 *   node scripts/aplicar-esquema.js
 *   node scripts/aplicar-esquema.js --solo-esquema   # omite la matriz
 *   node scripts/aplicar-esquema.js --verificar      # sólo comprueba el estado
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'priorizacion');
const SQL_FILE = path.join(ROOT, 'mpo.sql');
const MATRIZ_FILE = path.join(__dirname, 'matriz-mantenimiento-2026.sql');

const { Pool } = createRequire(path.join(APP_DIR, 'package.json'))('pg');

const TABLAS_ESPERADAS = [
    'siro_fichas_base',
    'siro_priorizacion_resultados',
    'siro_priorizacion_trazabilidad',
    'mspo_matrices',
    'mspo_grupos_priorizacion',
    'mspo_variables_priorizacion',
    'mspo_valores_variables',
    'mspo_ejecuciones_priorizacion',
    'mspo_resultados_fichas',
    'mspo_detalle_calculo_ficha',
];

const loadEnv = () => {
    const envPath = path.join(APP_DIR, '.env');
    if (!fs.existsSync(envPath)) {
        throw new Error(`No se encontró ${envPath}. Copiar .env.example y rellenarlo.`);
    }
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
        if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
};

// Misma lógica que priorizacion/lib/db.js.
const resolveSsl = (host) => {
    const mode = (process.env.PGSSLMODE || '').trim().toLowerCase();
    if (mode === 'disable') return false;
    if (mode) return { rejectUnauthorized: true };
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return local ? false : { rejectUnauthorized: true };
};

const verificar = async (client) => {
    const { rows: tablas } = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
    );
    const nombres = tablas.map((r) => r.table_name);
    const faltan = TABLAS_ESPERADAS.filter((t) => !nombres.includes(t));

    const { rows: vistas } = await client.query(
        `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
    );

    console.log(`\nTablas: ${nombres.length} (${TABLAS_ESPERADAS.length} esperadas)`);
    if (faltan.length) console.log(`  ⚠ Faltan: ${faltan.join(', ')}`);
    console.log(`Vistas: ${vistas.map((v) => v.table_name).join(', ') || '(ninguna)'}`);

    if (!faltan.includes('mspo_matrices')) {
        const { rows: m } = await client.query(
            `SELECT id_matriz, nombre_matriz, esta_activa FROM mspo_matrices ORDER BY id_matriz`,
        );
        console.log(`\nMatrices: ${m.length}`);
        for (const r of m) {
            console.log(`  [${r.id_matriz}] ${r.nombre_matriz} — activa: ${r.esta_activa}`);
        }

        const { rows: g } = await client.query(
            `SELECT COUNT(*)::int AS n, COALESCE(SUM(g.peso_grupo::numeric), 0) AS suma
             FROM mspo_grupos_priorizacion g
             JOIN mspo_matrices m ON m.id_matriz = g.id_matriz
             WHERE m.esta_activa = 1`,
        );
        console.log(`Grupos de la matriz activa: ${g[0].n} — suma de pesos: ${g[0].suma} (debe ser 100)`);

        const { rows: v } = await client.query(`SELECT COUNT(*)::int AS n FROM mspo_variables_priorizacion`);
        const { rows: vv } = await client.query(`SELECT COUNT(*)::int AS n FROM mspo_valores_variables`);
        console.log(`Variables: ${v[0].n} | Valores de variables: ${vv[0].n}`);
    }

    if (!faltan.includes('siro_fichas_base')) {
        const { rows: f } = await client.query(`SELECT COUNT(*)::int AS n FROM siro_fichas_base`);
        console.log(`\nFichas SIRO cargadas: ${f[0].n}`);
    }

    return { faltan };
};

const main = async () => {
    const args = process.argv.slice(2);
    const soloEsquema = args.includes('--solo-esquema');
    const soloVerificar = args.includes('--verificar');

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

    console.log(`Conectando a ${host}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}`);
    console.log(`  usuario: ${process.env.PGUSER} | TLS: ${ssl ? 'sí' : 'no'}`);

    const client = await pool.connect();
    try {
        const { rows: info } = await client.query(
            `SELECT version() AS v, current_database() AS db, current_user AS u`,
        );
        console.log(`  ✓ Conectado — ${info[0].v.split(',')[0]}`);

        if (soloVerificar) {
            await verificar(client);
            return;
        }

        console.log('\nAplicando esquema (idempotente) …');
        await client.query(fs.readFileSync(SQL_FILE, 'utf8'));
        console.log('  ✓ Tablas, índices y vista creados.');

        if (soloEsquema) {
            console.log('\n--solo-esquema: se omite la matriz.');
        } else {
            console.log('\nAplicando la matriz de mantenimiento (idempotente) …');
            await client.query(fs.readFileSync(MATRIZ_FILE, 'utf8'));
            console.log('  ✓ Matriz de mantenimiento aplicada.');
        }

        await verificar(client);
    } finally {
        client.release();
        await pool.end();
    }
};

main().catch((err) => {
    console.error('\n✗', err.message);
    if (err.code) console.error('  código PostgreSQL:', err.code);
    process.exit(1);
});
