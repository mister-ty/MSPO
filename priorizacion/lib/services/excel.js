const XLSX = require('xlsx');
const prioritizationService = require('./prioritization');

const processRows = async (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            resultados: [],
            excepciones: [],
            stats: { total_excel: 0, ignoradas: 0, excepciones: 0, priorizadas: 0 },
        };
    }

    const headers = rows[0];

    const headerMap = {};
    headers.forEach((h, i) => {
        if (h) headerMap[String(h).toUpperCase().trim()] = i;
    });

    const codigoFichaIdx = headerMap['CODIGO FICHA'];
    const estadoIdx = headerMap['ESTADO FICHA'];
    const reservadaIdx = headerMap['FICHA RESERVADA'];

    const calificacionKey = Object.keys(headerMap).find((k) => k.includes('CALIFICACION MATRIZ') || k.includes('CALIFICACIÓN MATRIZ'));
    const tipoMatrizKey = Object.keys(headerMap).find((k) => k.includes('TIPO MATRIZ') || k.includes('TIPO DE MATRIZ'));

    const calificacionIdx = calificacionKey ? headerMap[calificacionKey] : -1;
    const tipoMatrizIdx = tipoMatrizKey ? headerMap[tipoMatrizKey] : -1;

    let countIgnored = 0;
    const excepciones = [];
    const validFichas = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const codigoFicha = row[codigoFichaIdx];
        const calificacion = calificacionIdx !== -1 ? row[calificacionIdx] : null;
        const tipoMatriz = tipoMatrizIdx !== -1 ? row[tipoMatrizIdx] : null;
        const estado = row[estadoIdx];
        const reservada = row[reservadaIdx];

        if (!tipoMatriz || !String(tipoMatriz).toLowerCase().includes('unidad de mantenimiento')) {
            countIgnored++;
            continue;
        }

        const issues = [];

        if (!calificacion || String(calificacion) === '0' || String(calificacion) === '') {
            issues.push("Falta 'Calificación Matriz' o es cero");
        }

        if (estado === 'Ejecutada') {
            issues.push(`Estado Administrativo no válido ('${estado}')`);
        }

        if (String(reservada).toUpperCase() === 'SI' || String(reservada) === 'TRUE') {
            issues.push('La ficha está Reservada');
        }

        if (issues.length > 0) {
            excepciones.push({
                codigoFicha,
                issues,
                calificacion,
                tipoMatriz,
                estado,
            });
        } else {
            const fichaObj = {};
            headers.forEach((h, idx) => {
                fichaObj[String(h).toUpperCase().trim()] = row[idx];
            });
            validFichas.push(fichaObj);
        }
    }

    let resultadosArray = [];
    let exclusionesPriorizacion = [];

    if (validFichas.length > 0) {
        const codigos = validFichas.map((f) => f['CODIGO FICHA']);
        const priorizacionRes = await prioritizationService.runMassivePrioritization(validFichas, 'admin_excel', codigos);
        resultadosArray = priorizacionRes.resultados || [];

        if (priorizacionRes.exclusiones && priorizacionRes.exclusiones.length > 0) {
            exclusionesPriorizacion = priorizacionRes.exclusiones;
        }
    }

    return {
        resultados: resultadosArray,
        excepciones: [...excepciones, ...exclusionesPriorizacion],
        stats: {
            total_excel: rows.length - 1,
            ignoradas: countIgnored,
            excepciones: excepciones.length + exclusionesPriorizacion.length,
            priorizadas: resultadosArray.length,
        },
    };
};

const generateExportExcel = (report) => {
    const wb = XLSX.utils.book_new();
    const { resultados, excepciones, stats } = report;
    const fechaGeneracion = new Date().toISOString().split('T')[0];

    const resumenData = [
        ['REPORTE DE PRIORIZACIÓN - MSPO 2026'],
        ['Generado el:', fechaGeneracion],
        [],
        ['ESTADÍSTICAS GENERALES'],
        ['Métrica', 'Valor'],
        ['Total filas procesadas', stats.total_excel],
        ['Fichas ignoradas (No Unidad de Mantenimiento)', stats.ignoradas],
        ['Fichas con excepción', stats.excepciones],
        ['Fichas priorizadas exitosamente', stats.priorizadas],
        [],
        ['PORCENTAJE DE PRIORIZACIÓN', `${stats.priorizadas > 0 ? ((stats.priorizadas / (stats.priorizadas + stats.excepciones)) * 100).toFixed(1) : 0}%`],
        ['PORCENTAJE DE EXCEPCIÓN', `${stats.excepciones > 0 ? ((stats.excepciones / (stats.priorizadas + stats.excepciones)) * 100).toFixed(1) : 0}%`],
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
    wsResumen['!cols'] = [{ wch: 50 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const groupNames = new Set();
    for (const r of resultados) {
        if (r.detallesPorGrupo) {
            r.detallesPorGrupo.forEach((g) => groupNames.add(g.nombreGrupo));
        }
    }
    const sortedGroups = [...groupNames];

    const prioHeaders = ['Código Ficha', 'Puntaje Final', ...sortedGroups.map((g) => `Pts. ${g}`)];
    const prioRows = [prioHeaders];

    for (const r of resultados) {
        const row = [r.codigo_ficha, r.puntajeFinal];
        for (const gName of sortedGroups) {
            const grupo = (r.detallesPorGrupo || []).find((g) => g.nombreGrupo === gName);
            row.push(grupo ? grupo.puntajePonderado : 0);
        }
        prioRows.push(row);
    }

    const wsPrio = XLSX.utils.aoa_to_sheet(prioRows);
    wsPrio['!cols'] = [
        { wch: 20 }, { wch: 14 },
        ...sortedGroups.map(() => ({ wch: 22 })),
    ];
    XLSX.utils.book_append_sheet(wb, wsPrio, 'Fichas Priorizadas');

    const detalleHeaders = ['Código Ficha', 'Puntaje Final', 'Grupo', 'Variable', 'Valor Usado', 'Puntaje Variable'];
    const detalleRows = [detalleHeaders];

    for (const r of resultados) {
        const traza = r.trazaDetallada || [];
        for (const item of traza) {
            detalleRows.push([
                r.codigo_ficha,
                r.puntajeFinal,
                item.nombreGrupo,
                item.nombreVariable || 'N/A',
                item.valorUsado !== undefined && item.valorUsado !== null ? String(item.valorUsado) : 'N/A',
                item.puntajeObtenido,
            ]);
        }
    }

    const wsDetalle = XLSX.utils.aoa_to_sheet(detalleRows);
    wsDetalle['!cols'] = [
        { wch: 20 }, { wch: 14 }, { wch: 35 }, { wch: 40 }, { wch: 30 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle Variables');

    const excHeaders = ['Código Ficha', 'Tipo Matriz', 'Calificación', 'Estado', 'Motivos de Rechazo'];
    const excRows = [excHeaders];

    for (const exc of excepciones) {
        const code = exc.codigoFicha || exc.codigo_ficha || 'N/A';
        const issues = exc.issues ? exc.issues.join(' | ') : exc.motivo || 'N/A';
        excRows.push([
            code,
            exc.tipoMatriz || 'N/A',
            exc.calificacion || 'N/A',
            exc.estado || 'N/A',
            issues,
        ]);
    }

    const wsExc = XLSX.utils.aoa_to_sheet(excRows);
    wsExc['!cols'] = [
        { wch: 20 }, { wch: 55 }, { wch: 14 }, { wch: 18 }, { wch: 50 },
    ];
    XLSX.utils.book_append_sheet(wb, wsExc, 'Excepciones');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const processExcel = async (fileBuffer) => {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer', dense: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    return processRows(rows);
};

module.exports = {
    processExcel,
    processRows,
    generateExportExcel,
};
