#!/usr/bin/env node
/**
 * Carga los exports .xlsx del SIRO en `siro_fichas_base`.
 *
 * Por qué existe: `mpo.sql` sólo crea el esquema y siembra la matriz. La tabla
 * de fichas queda vacía, y como `siro_priorizacion_resultados` tiene una FK
 * contra `siro_fichas_base("CODIGO FICHA")`, el flujo de priorización del lado
 * servidor falla por violación de FK sobre una base recién creada. Este script
 * llena ese hueco.
 *
 * Es una herramienta de un solo uso, pensada para correr desde una máquina de
 * confianza contra Azure — no forma parte de la app desplegada.
 *
 * Uso:
 *   node scripts/cargar-fichas-siro.js                  # todos los .xlsx de la raíz
 *   node scripts/cargar-fichas-siro.js "a.xlsx" "b.xlsx"
 *   node scripts/cargar-fichas-siro.js --dry-run        # sin escribir nada
 *   node scripts/cargar-fichas-siro.js --normalizar-estados
 *
 * ⚠ IMPORTANTE — desajuste de vocabulario en ESTADO FICHA.
 * Los exports reales usan: Registrada (8.759), Ejecutada (2.687),
 * "Parcial - Pendiente Por Ejecutar" (135) y Anulada (127).
 * Pero lib/repositories/siro.js:18 y la vista siro_vw_fichas_para_priorizar
 * filtran por IN ('Sin ejecutar', 'Parcialmente ejecutada'). No hay ni una
 * coincidencia: cargando los datos tal cual, el flujo de priorización del lado
 * servidor encuentra CERO fichas priorizables.
 *
 * Por defecto este script carga los valores tal como vienen (fiel al origen).
 * Con --normalizar-estados aplica la traducción de ESTADO_NORMALIZACION.
 * Cuál es la correcta es una decisión de negocio: o se traduce al cargar, o se
 * corrige el filtro de la aplicación. Decidirlo antes de la carga definitiva.
 *
 * Lee la conexión de priorizacion/.env (las mismas variables que la app).
 *
 * Privacidad: los .xlsx traen 65 columnas, entre ellas NOMBRE CIUDADANO y
 * DIRECCION. Este script proyecta únicamente las 18 columnas que el esquema
 * persiste; los datos personales no salen del archivo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'priorizacion');

// Las dependencias viven en la app; este directorio no tiene package.json.
const appRequire = createRequire(path.join(APP_DIR, 'package.json'));
const XLSX = appRequire('xlsx');
const { Pool } = appRequire('pg');

const BATCH_SIZE = 500; // 18 columnas x 500 filas = 9.000 parámetros, muy por
                        // debajo del techo de 65.535 de PostgreSQL.

// --- Configuración ------------------------------------------------------

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

// Misma lógica que priorizacion/lib/db.js: Azure exige TLS, un Postgres local
// normalmente no lo ofrece.
const resolveSsl = (host) => {
    const mode = (process.env.PGSSLMODE || '').trim().toLowerCase();
    if (mode === 'disable') return false;
    if (mode) return { rejectUnauthorized: true };
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return local ? false : { rejectUnauthorized: true };
};

// --- Mapeo de columnas --------------------------------------------------

// Columna destino -> cómo obtener el valor de la fila de origen.
// `alias` cubre las variantes de cabecera que ya tolera lib/services/excel.js
// (acentos, "TIPO DE MATRIZ") y el caso de "TIENE UBICACION", que en el Excel
// viene sin signos de interrogación ni tilde.
const COLUMNS = [
    { target: 'CODIGO FICHA',                      source: 'CODIGO FICHA', kind: 'text', required: true },
    { target: 'GRUPO SOLICITUD',                   source: 'GRUPO SOLICITUD', kind: 'text' },
    { target: 'TIPO SOLICITUD',                    source: 'TIPO SOLICITUD', kind: 'text' },
    { target: 'FECHA REGISTRO FICHA',              source: 'FECHA REGISTRO FICHA', kind: 'date' },
    { target: 'FECHA',                             source: 'FECHA', kind: 'date' },
    { target: 'TIPO MATRIZ',                       source: 'TIPO MATRIZ', alias: ['TIPO DE MATRIZ'], kind: 'text' },
    { target: 'CALIFICACION MATRIZ',               source: 'CALIFICACION MATRIZ', alias: ['CALIFICACIÓN MATRIZ'], kind: 'text' },
    { target: 'AMENAZA AVENIDAS TORRENCIALES',     source: 'AMENAZA AVENIDAS TORRENCIALES', kind: 'text' },
    { target: 'AMENAZA INUNDACIONES',              source: 'AMENAZA INUNDACIONES', kind: 'text' },
    { target: 'AMENAZA MOVIMIENTO EN MASA',        source: 'AMENAZA MOVIMIENTO EN MASA', kind: 'text' },
    { target: 'RETIROS DE QUEBRADA',               source: 'RETIROS DE QUEBRADA', kind: 'text' },
    { target: 'PROYECTOS VIALES',                  source: 'PROYECTOS VIALES', kind: 'text' },
    { target: 'ESPACIO PUBLICO PROYECTADO',        source: 'ESPACIO PUBLICO PROYECTADO', alias: ['ESPACIO PÚBLICO PROYECTADO'], kind: 'text' },
    { target: 'CATEGORIA EQUIPAMIENTO',            source: 'CATEGORIA EQUIPAMIENTO', alias: ['CATEGORÍA EQUIPAMIENTO'], kind: 'text' },
    { target: 'CANTIDAD SOLICITUDES RELACIONADAS', source: 'CANTIDAD SOLICITUDES RELACIONADAS', kind: 'int' },
    { target: 'ESTADO FICHA',                      source: 'ESTADO FICHA', kind: 'estado' },
    { target: 'FICHA RESERVADA',                   source: 'FICHA RESERVADA', kind: 'bool01' },
    { target: '¿TIENE UBICACIÓN?',                 source: 'TIENE UBICACION', alias: ['TIENE UBICACIÓN', '¿TIENE UBICACIÓN?'], kind: 'sino' },
];

// Traducción del vocabulario real del SIRO al que espera la aplicación.
// Sólo se aplica con --normalizar-estados. Los estados no listados se dejan
// intactos: ni Ejecutada ni Anulada son priorizables en ninguna de las dos
// convenciones, así que traducirlos no cambiaría nada.
const ESTADO_NORMALIZACION = {
    'REGISTRADA': 'Sin ejecutar',
    'PARCIAL - PENDIENTE POR EJECUTAR': 'Parcialmente ejecutada',
};

let normalizarEstados = false;

const isTruthy = (v) => ['SI', 'SÍ', 'TRUE', '1', 'X', 'YES'].includes(String(v).trim().toUpperCase());

const pad2 = (n) => String(n).padStart(2, '0');

// El motor de priorización hace `new Date(valor)` sobre FECHA
// (lib/services/prioritization.js:90), así que un serial de Excel guardado como
// texto produciría una fecha absurda. Se normaliza a YYYY-MM-DD.
const toDateText = (v) => {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
        return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    }
    const s = String(v).trim();
    return s === '' ? null : s;
};

const convert = (kind, raw) => {
    switch (kind) {
        case 'date':
            return toDateText(raw);
        case 'int': {
            if (raw == null || raw === '') return null;
            const n = parseInt(String(raw).trim(), 10);
            return Number.isNaN(n) ? null : n;
        }
        case 'bool01':
            // Columna NOT NULL DEFAULT 0 en el esquema.
            return isTruthy(raw) ? 1 : 0;
        case 'sino':
            return isTruthy(raw) ? 'SI' : 'NO';
        case 'estado': {
            // Columna NOT NULL DEFAULT 'Sin ejecutar'.
            const s = raw == null ? '' : String(raw).trim();
            if (s === '') return 'Sin ejecutar';
            if (normalizarEstados) {
                return ESTADO_NORMALIZACION[s.toUpperCase()] || s;
            }
            return s;
        }
        default: {
            if (raw == null) return null;
            const s = String(raw).trim();
            return s === '' ? null : s;
        }
    }
};

// --- Lectura de un archivo ---------------------------------------------

const readWorkbook = (filePath) => {
    // cellDates convierte las celdas de fecha en objetos Date en vez de seriales.
    const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', dense: true, cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1 });
};

// Misma normalización de cabeceras que lib/services/excel.js:17.
const buildHeaderMap = (headers) => {
    const map = {};
    headers.forEach((h, i) => {
        if (h != null && String(h).trim() !== '') map[String(h).toUpperCase().trim()] = i;
    });
    return map;
};

const resolveIndex = (headerMap, col) => {
    const names = [col.source, ...(col.alias || [])];
    for (const n of names) {
        if (n in headerMap) return headerMap[n];
    }
    // Último recurso: coincidencia parcial, como hace excel.js para las
    // variantes acentuadas de CALIFICACION/TIPO MATRIZ.
    const found = Object.keys(headerMap).find((k) => names.some((n) => k.includes(n)));
    return found !== undefined ? headerMap[found] : -1;
};

const extractRows = (filePath) => {
    const rows = readWorkbook(filePath);
    if (rows.length < 2) return { records: [], missingHeaders: [], skippedNoCode: 0 };

    const headerMap = buildHeaderMap(rows[0]);
    const indices = COLUMNS.map((c) => ({ col: c, idx: resolveIndex(headerMap, c) }));
    const missingHeaders = indices.filter((x) => x.idx === -1).map((x) => x.col.target);

    const codigoIdx = indices.find((x) => x.col.target === 'CODIGO FICHA').idx;
    if (codigoIdx === -1) {
        throw new Error(`${path.basename(filePath)}: no se encontró la columna "CODIGO FICHA".`);
    }

    const records = [];
    let skippedNoCode = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const codigo = convert('text', row[codigoIdx]);
        if (!codigo) { skippedNoCode++; continue; }

        records.push(indices.map(({ col, idx }) => convert(col.kind, idx === -1 ? null : row[idx])));
    }

    return { records, missingHeaders, skippedNoCode };
};

// --- Inserción ----------------------------------------------------------

const COLUMN_LIST = COLUMNS.map((c) => `"${c.target}"`).join(', ');

const insertBatch = async (client, batch) => {
    const cols = COLUMNS.length;
    const tuples = batch
        .map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(', ')})`)
        .join(', ');

    // ON CONFLICT DO NOTHING: los códigos pueden repetirse entre archivos y el
    // script debe poder re-ejecutarse sin romper.
    const sql = `INSERT INTO siro_fichas_base (${COLUMN_LIST}) VALUES ${tuples}
                 ON CONFLICT ("CODIGO FICHA") DO NOTHING`;

    const res = await client.query(sql, batch.flat());
    return res.rowCount;
};

// --- Main ---------------------------------------------------------------

const main = async () => {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    normalizarEstados = args.includes('--normalizar-estados');
    const fileArgs = args.filter((a) => !a.startsWith('--'));

    console.log(
        normalizarEstados
            ? 'ESTADO FICHA: traduciendo al vocabulario de la aplicación (--normalizar-estados).'
            : 'ESTADO FICHA: se cargan los valores tal como vienen del SIRO.',
    );

    const files = (fileArgs.length > 0 ? fileArgs : fs.readdirSync(ROOT).filter((f) => /\.xlsx?$/i.test(f)))
        .map((f) => (path.isAbsolute(f) ? f : path.join(ROOT, f)));

    if (files.length === 0) {
        console.error('No se encontró ningún .xlsx en', ROOT);
        process.exit(1);
    }

    console.log(`Archivos a procesar: ${files.length}`);

    // Deduplicar por código: "CODIGO FICHA" es PK y un mismo código puede
    // aparecer en más de un archivo. Un lote con duplicados internos falla
    // entero, porque ON CONFLICT no resuelve conflictos dentro del mismo INSERT.
    const seen = new Set();
    const all = [];
    let totalLeidas = 0;
    let totalDuplicados = 0;
    let totalSinCodigo = 0;

    for (const file of files) {
        const { records, missingHeaders, skippedNoCode } = extractRows(file);
        totalLeidas += records.length;
        totalSinCodigo += skippedNoCode;

        let dupes = 0;
        for (const rec of records) {
            const codigo = rec[0];
            if (seen.has(codigo)) { dupes++; continue; }
            seen.add(codigo);
            all.push(rec);
        }
        totalDuplicados += dupes;

        console.log(
            `  ${path.basename(file)}: ${records.length} filas` +
            (dupes ? `, ${dupes} duplicadas` : '') +
            (skippedNoCode ? `, ${skippedNoCode} sin código` : '') +
            (missingHeaders.length ? `\n     ⚠ columnas ausentes (van a NULL/default): ${missingHeaders.join(', ')}` : ''),
        );
    }

    console.log(
        `\nTotal leído: ${totalLeidas} | únicas: ${all.length} | duplicadas: ${totalDuplicados}` +
        ` | sin código: ${totalSinCodigo}`,
    );

    // Cuántas fichas quedarán realmente priorizables según el filtro que aplica
    // lib/repositories/siro.js:18. Si sale 0, la app no podrá priorizar nada y
    // conviene saberlo antes de escribir, no después.
    const idxEstado = COLUMNS.findIndex((c) => c.target === 'ESTADO FICHA');
    const idxReservada = COLUMNS.findIndex((c) => c.target === 'FICHA RESERVADA');
    const priorizables = all.filter(
        (r) => ['Sin ejecutar', 'Parcialmente ejecutada'].includes(r[idxEstado]) && r[idxReservada] === 0,
    ).length;

    console.log(`Priorizables según el filtro de la app: ${priorizables}`);
    if (priorizables === 0) {
        console.warn(
            '\n⚠ Ninguna ficha pasará el filtro IN (\'Sin ejecutar\', \'Parcialmente ejecutada\')\n' +
            '  de lib/repositories/siro.js:18. El flujo servidor de priorización devolverá 0\n' +
            '  resultados. Revisar --normalizar-estados o corregir el filtro de la aplicación.',
        );
    }

    if (dryRun) {
        console.log('\n--dry-run: no se escribió nada.');
        if (all.length > 0) {
            console.log('\nPrimer registro que se insertaría:');
            COLUMNS.forEach((c, i) => console.log(`  ${c.target} = ${JSON.stringify(all[0][i])}`));
        }
        return;
    }

    loadEnv();
    for (const k of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
        if (!process.env[k]) throw new Error(`Falta la variable ${k} en priorizacion/.env`);
    }

    const host = process.env.PGHOST;
    const pool = new Pool({
        host,
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: resolveSsl(host),
        max: 1,
        connectionTimeoutMillis: 15_000,
    });

    console.log(`\nConectando a ${host}/${process.env.PGDATABASE} …`);
    const client = await pool.connect();

    let insertadas = 0;
    try {
        await client.query('BEGIN');
        for (let i = 0; i < all.length; i += BATCH_SIZE) {
            const batch = all.slice(i, i + BATCH_SIZE);
            insertadas += await insertBatch(client, batch);
            process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, all.length)}/${all.length} procesadas …`);
        }
        await client.query('COMMIT');
        console.log('');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\nError, se revirtió todo el lote:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }

    const yaExistian = all.length - insertadas;
    console.log(`\n✓ Insertadas: ${insertadas}`);
    if (yaExistian > 0) console.log(`  Ya existían (sin cambios): ${yaExistian}`);
};

main().catch((err) => {
    console.error('\n✗', err.message);
    process.exit(1);
});
