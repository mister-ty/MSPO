const siroRepository = require('../repositories/siro');
const mspoRepository = require('../repositories/mspo');

const COLUMN_MAPPING = {
    'CALIFICACION MATRIZ': 'CALIFICACION MATRIZ',

    'AMENAZA AVENIDAS TORRENCIALES': 'AMENAZA AVENIDAS TORRENCIALES',
    'AMENAZA INUNDACIONES': 'AMENAZA INUNDACIONES',
    'AMENAZA MOVIMIENTO EN MASA': 'AMENAZA MOVIMIENTO EN MASA',
    'RETIROS DE QUEBRADA': 'RETIROS DE QUEBRADA',
    'PROYECTOS VIALES': 'PROYECTOS VIALES',
    'ESPACIO PUBLICO PROYECTADO': 'ESPACIO PUBLICO PROYECTADO',

    'CATEGORIA EQUIPAMIENTO': 'CATEGORIA EQUIPAMIENTO',

    'CANTIDAD SOLICITUDES RELACIONADAS': 'CANTIDAD SOLICITUDES RELACIONADAS',
    'FECHA': 'FECHA',
};

const _calculateFichaScore = (ficha, matrixConfig) => {
    let puntajeFinal = 0;
    const detallesPorGrupo = [];
    const trazaDetallada = [];

    const califMatriz = ficha['CALIFICACION MATRIZ'];
    if (califMatriz === null || califMatriz === undefined || califMatriz === '') {
        throw new Error('No puedo priorizar porque no cumple con las condiciones: falta calificación matriz');
    }

    for (const grupo of matrixConfig.grupos) {
        let puntajeAcumuladoGrupo = 0;

        if (grupo.nombre_grupo === 'Calificación de la infraestructura') {
            const valor = parseFloat(califMatriz);
            puntajeAcumuladoGrupo = isNaN(valor) ? 0 : valor;

            trazaDetallada.push({
                nombreGrupo: grupo.nombre_grupo,
                nombreVariable: 'CALIFICACION MATRIZ',
                valorUsado: califMatriz,
                puntajeObtenido: puntajeAcumuladoGrupo,
            });
        } else if (grupo.nombre_grupo === 'Cercanía con equipamientos') {
            const variable = grupo.variables.find((v) => v.nombre_variable === 'CATEGORIA EQUIPAMIENTO' || v.nombre_variable === 'Tipo de Equipamiento Cercano');
            if (variable) {
                const rawValue = ficha['CATEGORIA EQUIPAMIENTO'];
                let puntajeAsignado = 0;

                if (!rawValue || rawValue === 'Sin Información') {
                    puntajeAsignado = 0;
                } else {
                    let maxScore = 0;
                    variable.valores.forEach((configVal) => {
                        if (String(rawValue).includes(configVal.valor_entrada)) {
                            const punt = Number(configVal.puntaje_asignado);
                            if (punt > maxScore) maxScore = punt;
                        }
                    });
                    puntajeAsignado = maxScore;
                }
                puntajeAcumuladoGrupo = puntajeAsignado;

                trazaDetallada.push({
                    nombreGrupo: grupo.nombre_grupo,
                    nombreVariable: 'CATEGORIA EQUIPAMIENTO',
                    valorUsado: rawValue,
                    puntajeObtenido: puntajeAsignado,
                });
            }
        } else {
            for (const variable of grupo.variables) {
                const columnaSiro = COLUMN_MAPPING[variable.nombre_variable];
                if (!columnaSiro) continue;

                const valorFicha = ficha[columnaSiro];
                let puntajeVariable = 0;

                if (variable.nombre_variable === 'CANTIDAD SOLICITUDES RELACIONADAS') {
                    let n = 0;
                    if (valorFicha && !isNaN(valorFicha)) {
                        n = parseInt(valorFicha, 10);
                    }
                    if (n > 30) puntajeVariable = 100;
                    else if (n > 15) puntajeVariable = 50;
                    else puntajeVariable = 30;
                } else if (variable.nombre_variable === 'FECHA') {
                    if (!valorFicha) {
                        puntajeVariable = 0;
                    } else {
                        const fechaRad = new Date(valorFicha);
                        const hoy = new Date();
                        const diffTime = Math.abs(hoy - fechaRad);
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        const diffYears = diffDays / 365;

                        if (diffYears > 4) puntajeVariable = 100;
                        else if (diffYears >= 2) puntajeVariable = 50;
                        else puntajeVariable = 30;
                    }
                } else {
                    const valLimpio = typeof valorFicha === 'string' ? valorFicha.trim() : valorFicha;

                    if (!valLimpio) {
                        const sinInfo = variable.valores.find((v) => v.valor_entrada === 'Sin Información');
                        puntajeVariable = sinInfo ? Number(sinInfo.puntaje_asignado) : 100;
                    } else {
                        const configValor = variable.valores.find((v) => v.valor_entrada === valLimpio);
                        puntajeVariable = configValor ? Number(configValor.puntaje_asignado) : 0;
                    }
                }

                puntajeAcumuladoGrupo += (puntajeVariable * (Number(variable.peso_variable) / 100));

                trazaDetallada.push({
                    nombreGrupo: grupo.nombre_grupo,
                    nombreVariable: variable.nombre_variable,
                    valorUsado: valorFicha,
                    puntajeObtenido: puntajeVariable,
                });
            }
        }

        const aporteGrupo = (puntajeAcumuladoGrupo * (Number(grupo.peso_grupo) / 100));
        puntajeFinal += aporteGrupo;

        detallesPorGrupo.push({
            nombreGrupo: grupo.nombre_grupo,
            puntajePonderado: parseFloat(aporteGrupo.toFixed(2)),
        });
    }

    return {
        puntajeFinal: parseFloat(puntajeFinal.toFixed(2)),
        detallesPorGrupo,
        trazaDetallada,
    };
};

const getFichas = async (filters) => siroRepository.findPrioritizableFichas(filters);

const runMassivePrioritization = async (fichasData, user, requestedCodigos = []) => {
    const matrixConfig = await mspoRepository.getActiveMatrixConfiguration();
    if (!matrixConfig) throw new Error('No hay una matriz de priorización activa configurada.');

    const id_ejecucion = await mspoRepository.createExecutionLog(user, 'Masiva_Calibrada_2026', matrixConfig.id_matriz);

    const fullResults = fichasData.map((ficha) => {
        try {
            const { puntajeFinal, detallesPorGrupo, trazaDetallada } = _calculateFichaScore(ficha, matrixConfig);
            return {
                id_ejecucion,
                codigo_ficha: ficha['CODIGO FICHA'],
                puntajeFinal,
                detallesPorGrupo,
                trazaDetallada,
                inputs: ficha,
            };
        } catch (e) {
            return { error: e.message, codigo_ficha: ficha['CODIGO FICHA'] };
        }
    });

    const successfulResults = fullResults.filter((r) => !r.error);
    const errors = fullResults.filter((r) => r.error);

    const exclusiones = [];
    errors.forEach((e) => exclusiones.push({ codigo_ficha: e.codigo_ficha, motivo: e.error }));

    if (requestedCodigos.length > 0) {
        const processedSet = new Set(successfulResults.map((f) => f.codigo_ficha));
        const errorSet = new Set(errors.map((e) => e.codigo_ficha));
        const missing = requestedCodigos.filter((c) => !processedSet.has(c) && !errorSet.has(c));

        for (const cod of missing) {
            const motivo = await siroRepository.diagnoseFicha(cod);
            exclusiones.push({ codigo_ficha: cod, motivo });
        }
    }

    try {
        if (successfulResults.length > 0) {
            await mspoRepository.saveFullTrace(successfulResults);
            await siroRepository.saveResults(successfulResults);
        }
    } catch (error) {
        console.error('CRITICAL CALIBRATION SYNC ERROR:', error);
        throw new Error(`Fallo en la sincronización de resultados calibrados: ${error.message}`);
    }

    return {
        ejecucion_id: id_ejecucion,
        procesadas: successfulResults.length,
        resultados: successfulResults,
        exclusiones,
    };
};

const createFicha = async (data) => siroRepository.createFicha(data);

module.exports = {
    getFichas,
    runMassivePrioritization,
    createFicha,
};
