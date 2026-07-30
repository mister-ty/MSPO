// Repositorio de las tablas `siro_*` (esquema fuera del proyecto, ver
// `mpo.sql` en la raíz del repositorio). Los identificadores con
// espacios y `¿?` se preservan entre comillas dobles para reflejar el Excel
// SIRO de origen.

const { getSiroPool, getRawClient } = require('../db');

const findPrioritizableFichas = async (filters = {}) => {
    const siroPool = getSiroPool();
    const { startDate, endDate, grupoSolicitud, codigos } = filters;

    let query = `
    SELECT *
    FROM siro_fichas_base
    WHERE 1=1
  `;

    query += ` AND "ESTADO FICHA" IN ('Sin ejecutar', 'Parcialmente ejecutada')`;
    query += ` AND "FICHA RESERVADA" = 0`;

    const params = [];

    if (startDate) {
        query += ` AND "FECHA" >= ?`;
        params.push(startDate);
    }
    if (endDate) {
        query += ` AND "FECHA" <= ?`;
        params.push(endDate);
    }

    if (grupoSolicitud) {
        query += ` AND "GRUPO SOLICITUD" = ?`;
        params.push(grupoSolicitud);
    }

    if (codigos && Array.isArray(codigos) && codigos.length > 0) {
        const placeholders = codigos.map(() => '?').join(',');
        query += ` AND "CODIGO FICHA" IN (${placeholders})`;
        params.push(...codigos);
    }

    const { rows } = await siroPool.query(query, params);
    return rows;
};

// UPSERT del resultado + reemplazo atómico de su trazabilidad.
const saveResults = async (results) => {
    const client = getRawClient();
    const tx = await client.transaction('write');
    try {
        for (const result of results) {
            const { codigo_ficha, puntajeFinal, detallesPorGrupo } = result;

            const mainRes = await tx.execute({
                sql: `INSERT INTO siro_priorizacion_resultados
                          (codigo_ficha, puntaje_final, responsable_ejecucion, es_activo)
                      VALUES (?, ?, ?, 1)
                      ON CONFLICT (codigo_ficha) DO UPDATE
                          SET puntaje_final = EXCLUDED.puntaje_final,
                              responsable_ejecucion = EXCLUDED.responsable_ejecucion,
                              es_activo = 1
                      RETURNING id_resultado`,
                args: [codigo_ficha, String(puntajeFinal), 'admin'],
            });
            const idResultadoSiro = Number(mainRes.rows[0].id_resultado);

            await tx.execute({
                sql: `DELETE FROM siro_priorizacion_trazabilidad WHERE id_resultado = ?`,
                args: [idResultadoSiro],
            });

            for (const grupo of detallesPorGrupo) {
                await tx.execute({
                    sql: `INSERT INTO siro_priorizacion_trazabilidad
                              (id_resultado, nombre_campo, valor_calculado)
                          VALUES (?, ?, ?)`,
                    args: [idResultadoSiro, grupo.nombreGrupo, String(grupo.puntajePonderado)],
                });
            }
        }
        await tx.commit();
    } catch (error) {
        await tx.rollback();
        console.error('SYNC ERROR (SIRO):', error.message);
        throw error;
    }
};

const diagnoseFicha = async (codigo_ficha) => {
    const siroPool = getSiroPool();
    const query = `
    SELECT *
    FROM siro_vw_fichas_para_priorizar
    WHERE "CODIGO FICHA" = ?
  `;
    const { rows } = await siroPool.query(query, [codigo_ficha]);

    if (rows.length === 0) return 'Ficha no encontrada en la vista técnica';

    const f = {};
    for (const key in rows[0]) f[key.toUpperCase()] = rows[0][key];

    const causes = [];
    if (!['Sin ejecutar', 'Parcialmente ejecutada'].includes(f['ESTADO FICHA'])) causes.push(`Estado: ${f['ESTADO FICHA']}`);
    if (f['FICHA RESERVADA']) causes.push('Ficha reservada');

    return causes.length > 0 ? `Excluida por: ${causes.join(', ')}` : 'Criterios técnicos OK, validar filtros dinámicos (fecha, grupo)';
};

const createFicha = async (fichaData) => {
    const siroPool = getSiroPool();
    const {
        codigo_ficha, grupo_intervencion_solicitud, tipo_intervencion_solicitud,
        fecha_registro_ficha, valor_calificacion,
        amenaza_avenidas_torrenciales, amenaza_inundaciones, amenaza_movimiento_en_masa,
        retiros_de_quebrada, proyectos_viales, espacio_publico_proyectado,
        categoria_equipamiento, cantidad_solicitudes_rel,
    } = fichaData;

    const query = `
      INSERT INTO siro_fichas_base (
        "CODIGO FICHA", "GRUPO SOLICITUD", "TIPO SOLICITUD",
        "FECHA REGISTRO FICHA", "FECHA", "CALIFICACION MATRIZ",
        "AMENAZA AVENIDAS TORRENCIALES", "AMENAZA INUNDACIONES", "AMENAZA MOVIMIENTO EN MASA",
        "RETIROS DE QUEBRADA", "PROYECTOS VIALES", "ESPACIO PUBLICO PROYECTADO",
        "CATEGORIA EQUIPAMIENTO", "CANTIDAD SOLICITUDES RELACIONADAS",
        "ESTADO FICHA", "FICHA RESERVADA", "¿TIENE UBICACIÓN?"
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'Sin ejecutar', 0, 'SI'
      ) RETURNING *
    `;

    const values = [
        codigo_ficha,
        grupo_intervencion_solicitud,
        tipo_intervencion_solicitud,
        fecha_registro_ficha,                 // "FECHA REGISTRO FICHA"
        fecha_registro_ficha,                 // "FECHA"
        valor_calificacion != null ? String(valor_calificacion) : null,
        amenaza_avenidas_torrenciales, amenaza_inundaciones, amenaza_movimiento_en_masa,
        retiros_de_quebrada, proyectos_viales, espacio_publico_proyectado,
        categoria_equipamiento,
        cantidad_solicitudes_rel,
    ];

    const { rows } = await siroPool.query(query, values);
    return rows[0];
};

module.exports = {
    findPrioritizableFichas,
    saveResults,
    diagnoseFicha,
    createFicha,
};
