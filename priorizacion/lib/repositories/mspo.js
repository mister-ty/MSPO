// Repositorio de las tablas `mspo_*` (esquema fuera del proyecto, ver
// `mpo.sql` en la raíz del repositorio): configuración de matriz y
// bitácora de ejecuciones.

const { getMspoPool, getRawClient } = require('../db');

const getActiveMatrixConfiguration = async () => {
    const mspoPool = getMspoPool();

    const matrixRes = await mspoPool.query(`
        SELECT id_matriz, nombre_matriz
        FROM mspo_matrices
        WHERE esta_activa = 1
        LIMIT 1
    `);

    if (matrixRes.rows.length === 0) return null;
    const matrix = matrixRes.rows[0];

    const groupsRes = await mspoPool.query(`
        SELECT id_grupo, nombre_grupo, peso_grupo
        FROM mspo_grupos_priorizacion
        WHERE id_matriz = ?
        ORDER BY id_grupo
    `, [matrix.id_matriz]);

    const groups = groupsRes.rows;

    for (const group of groups) {
        const varsRes = await mspoPool.query(`
            SELECT id_variable, nombre_variable, peso_variable
            FROM mspo_variables_priorizacion
            WHERE id_grupo = ?
            ORDER BY id_variable
        `, [group.id_grupo]);

        group.variables = varsRes.rows;

        for (const variable of group.variables) {
            const valuesRes = await mspoPool.query(`
                SELECT valor_entrada, puntaje_asignado
                FROM mspo_valores_variables
                WHERE id_variable = ?
            `, [variable.id_variable]);

            variable.valores = valuesRes.rows;
        }
    }

    return { ...matrix, grupos: groups };
};

const createExecutionLog = async (usuario, tipoEjecucion, idMatriz) => {
    const mspoPool = getMspoPool();
    const query = `
        INSERT INTO mspo_ejecuciones_priorizacion
        (responsable_ejecucion, tipo_ejecucion, id_matriz_usada)
        VALUES (?, ?, ?)
        RETURNING id_ejecucion
    `;
    const { rows } = await mspoPool.query(query, [usuario, tipoEjecucion, idMatriz]);
    return Number(rows[0].id_ejecucion);
};

// Inserta la traza completa de una ejecución masiva en transacción atómica.
const saveFullTrace = async (results) => {
    const client = getRawClient();
    const tx = await client.transaction('write');
    try {
        for (const result of results) {
            const { id_ejecucion, codigo_ficha, puntajeFinal, detallesPorGrupo, trazaDetallada, inputs } = result;

            const resultRes = await tx.execute({
                sql: `INSERT INTO mspo_resultados_fichas (
                    id_ejecucion,
                    codigo_ficha,
                    puntaje_final_calculado,
                    inputs_completos
                ) VALUES (?, ?, ?, ?)
                RETURNING id_resultado_ficha`,
                args: [
                    id_ejecucion,
                    codigo_ficha,
                    puntajeFinal != null ? String(puntajeFinal) : null,
                    JSON.stringify(inputs ?? {}),
                ],
            });

            const id_resultado_ficha = Number(resultRes.rows[0].id_resultado_ficha);

            const detalles = trazaDetallada || detallesPorGrupo;

            for (const item of detalles) {
                const nombreGrupo = item.nombreGrupo;
                const nombreVariable = item.nombreVariable || null;
                const valorUsado = item.valorUsado !== undefined ? String(item.valorUsado) : null;
                const puntajeVariable = item.puntajeObtenido !== undefined ? item.puntajeObtenido : 0;
                const puntajeGrupo = item.puntajePonderado !== undefined ? item.puntajePonderado : 0;

                await tx.execute({
                    sql: `INSERT INTO mspo_detalle_calculo_ficha (
                        id_resultado_ficha,
                        nombre_grupo,
                        nombre_variable,
                        valor_usado,
                        puntaje_obtenido_variable,
                        puntaje_ponderado_grupo
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    args: [
                        id_resultado_ficha,
                        nombreGrupo,
                        nombreVariable,
                        valorUsado,
                        String(puntajeVariable),
                        String(puntajeGrupo),
                    ],
                });
            }
        }
        await tx.commit();
    } catch (error) {
        await tx.rollback();
        console.error('TRACE ERROR (MSPO):', error.message);
        throw error;
    }
};

module.exports = {
    getActiveMatrixConfiguration,
    createExecutionLog,
    saveFullTrace,
};
