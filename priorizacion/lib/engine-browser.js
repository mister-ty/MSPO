import * as XLSX from "xlsx"

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
}

const calculateFichaScore = (ficha, matrixConfig) => {
    let puntajeFinal = 0
    const detallesPorGrupo = []
    const trazaDetallada = []

    const califMatriz = ficha['CALIFICACION MATRIZ']
    if (califMatriz === null || califMatriz === undefined || califMatriz === '') {
        throw new Error('No puedo priorizar porque no cumple con las condiciones: falta calificación matriz')
    }

    for (const grupo of matrixConfig.grupos) {
        let puntajeAcumuladoGrupo = 0

        if (grupo.nombre_grupo === 'Calificación de la infraestructura') {
            const valor = parseFloat(califMatriz)
            puntajeAcumuladoGrupo = isNaN(valor) ? 0 : valor

            trazaDetallada.push({
                nombreGrupo: grupo.nombre_grupo,
                nombreVariable: 'CALIFICACION MATRIZ',
                valorUsado: califMatriz,
                puntajeObtenido: puntajeAcumuladoGrupo,
            })
        } else if (grupo.nombre_grupo === 'Cercanía con equipamientos') {
            const variable = grupo.variables.find((v) => v.nombre_variable === 'CATEGORIA EQUIPAMIENTO' || v.nombre_variable === 'Tipo de Equipamiento Cercano')
            if (variable) {
                const rawValue = ficha['CATEGORIA EQUIPAMIENTO']
                let puntajeAsignado = 0

                if (!rawValue || rawValue === 'Sin Información') {
                    puntajeAsignado = 0
                } else {
                    let maxScore = 0
                    variable.valores.forEach((configVal) => {
                        if (String(rawValue).includes(configVal.valor_entrada)) {
                            const punt = Number(configVal.puntaje_asignado)
                            if (punt > maxScore) maxScore = punt
                        }
                    })
                    puntajeAsignado = maxScore
                }
                puntajeAcumuladoGrupo = puntajeAsignado

                trazaDetallada.push({
                    nombreGrupo: grupo.nombre_grupo,
                    nombreVariable: 'CATEGORIA EQUIPAMIENTO',
                    valorUsado: rawValue,
                    puntajeObtenido: puntajeAsignado,
                })
            }
        } else {
            for (const variable of grupo.variables) {
                const columnaSiro = COLUMN_MAPPING[variable.nombre_variable]
                if (!columnaSiro) continue

                const valorFicha = ficha[columnaSiro]
                let puntajeVariable = 0

                if (variable.nombre_variable === 'CANTIDAD SOLICITUDES RELACIONADAS') {
                    let n = 0
                    if (valorFicha !== null && valorFicha !== undefined && !isNaN(valorFicha)) {
                        n = parseInt(valorFicha, 10)
                    }
                    if (n > 30) puntajeVariable = 100
                    else if (n > 15) puntajeVariable = 50
                    else puntajeVariable = 30
                } else if (variable.nombre_variable === 'FECHA') {
                    if (!valorFicha) {
                        puntajeVariable = 0
                    } else {
                        const fechaRad = new Date(valorFicha)
                        const hoy = new Date()
                        const diffTime = Math.abs(hoy - fechaRad)
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                        const diffYears = diffDays / 365

                        if (diffYears > 4) puntajeVariable = 100
                        else if (diffYears >= 2) puntajeVariable = 50
                        else puntajeVariable = 30
                    }
                } else {
                    const valLimpio = typeof valorFicha === 'string' ? valorFicha.trim() : valorFicha

                    if (!valLimpio) {
                        const sinInfo = variable.valores.find((v) => v.valor_entrada === 'Sin Información')
                        puntajeVariable = sinInfo ? Number(sinInfo.puntaje_asignado) : 100
                    } else {
                        const configValor = variable.valores.find((v) => v.valor_entrada === valLimpio)
                        puntajeVariable = configValor ? Number(configValor.puntaje_asignado) : 0
                    }
                }

                puntajeAcumuladoGrupo += (puntajeVariable * (Number(variable.peso_variable) / 100))

                trazaDetallada.push({
                    nombreGrupo: grupo.nombre_grupo,
                    nombreVariable: variable.nombre_variable,
                    valorUsado: valorFicha,
                    puntajeObtenido: puntajeVariable,
                })
            }
        }

        const aporteGrupo = (puntajeAcumuladoGrupo * (Number(grupo.peso_grupo) / 100))
        puntajeFinal += aporteGrupo

        detallesPorGrupo.push({
            nombreGrupo: grupo.nombre_grupo,
            puntajePonderado: parseFloat(aporteGrupo.toFixed(2)),
        })
    }

    return {
        puntajeFinal: parseFloat(puntajeFinal.toFixed(2)),
        detallesPorGrupo,
        trazaDetallada,
    }
}

const parseCoord = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = parseFloat(String(v).replace(',', '.').trim())
    return isNaN(n) ? null : n
}

export const processRowsLocal = (rows, matrixConfig) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            resultados: [],
            excepciones: [],
            stats: { total_excel: 0, ignoradas: 0, excepciones: 0, priorizadas: 0 },
        }
    }

    const headers = rows[0]
    const headerMap = {}
    headers.forEach((h, i) => {
        if (h) headerMap[String(h).toUpperCase().trim()] = i
    })

    const codigoFichaIdx = headerMap['CODIGO FICHA']
    const estadoIdx = headerMap['ESTADO FICHA']
    const reservadaIdx = headerMap['FICHA RESERVADA']

    const calificacionKey = Object.keys(headerMap).find((k) => k.includes('CALIFICACION MATRIZ') || k.includes('CALIFICACIÓN MATRIZ'))
    const tipoMatrizKey = Object.keys(headerMap).find((k) => k.includes('TIPO MATRIZ') || k.includes('TIPO DE MATRIZ'))

    const calificacionIdx = calificacionKey ? headerMap[calificacionKey] : -1
    const tipoMatrizIdx = tipoMatrizKey ? headerMap[tipoMatrizKey] : -1

    const headerKeys = Object.keys(headerMap)
    const latKey =
        headerKeys.find((k) => k === 'LATITUD' || k === 'LATITUDE' || k === 'LAT') ||
        headerKeys.find((k) => /^LATITUD/.test(k) || /\bLATITUD\b/.test(k))
    const lngKey =
        headerKeys.find((k) => k === 'LONGITUD' || k === 'LONGITUDE' || k === 'LNG' || k === 'LON') ||
        headerKeys.find((k) => /^LONGITUD/.test(k) || /\bLONGITUD\b/.test(k))
    const direccionKey = headerKeys.find((k) => k === 'DIRECCION' || k === 'DIRECCIÓN' || /DIRECCION/.test(k) || /DIRECCIÓN/.test(k))
    const comunaKey = headerKeys.find((k) => k === 'COMUNA' || /\bCOMUNA\b/.test(k))
    const barrioKey = headerKeys.find((k) => k === 'BARRIO' || /\bBARRIO\b/.test(k))

    const latIdx = latKey ? headerMap[latKey] : -1
    const lngIdx = lngKey ? headerMap[lngKey] : -1
    const direccionIdx = direccionKey ? headerMap[direccionKey] : -1
    const comunaIdx = comunaKey ? headerMap[comunaKey] : -1
    const barrioIdx = barrioKey ? headerMap[barrioKey] : -1

    const extractGeoMeta = (row) => {
        let lat = latIdx !== -1 ? parseCoord(row[latIdx]) : null
        let lng = lngIdx !== -1 ? parseCoord(row[lngIdx]) : null
        if (lat !== null && (Math.abs(lat) > 90 || lat === 0)) lat = null
        if (lng !== null && (Math.abs(lng) > 180 || lng === 0)) lng = null
        const valid = lat !== null && lng !== null
        return {
            lat: valid ? lat : null,
            lng: valid ? lng : null,
            direccion: direccionIdx !== -1 ? row[direccionIdx] || null : null,
            comuna: comunaIdx !== -1 ? row[comunaIdx] || null : null,
            barrio: barrioIdx !== -1 ? row[barrioIdx] || null : null,
        }
    }

    let countIgnored = 0
    const excepciones = []
    const validFichas = []

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || row.length === 0) continue

        const codigoFicha = row[codigoFichaIdx]
        const calificacion = calificacionIdx !== -1 ? row[calificacionIdx] : null
        const tipoMatriz = tipoMatrizIdx !== -1 ? row[tipoMatrizIdx] : null
        const estado = row[estadoIdx]
        const reservada = row[reservadaIdx]

        if (!tipoMatriz || !String(tipoMatriz).toLowerCase().includes('unidad de mantenimiento')) {
            countIgnored++
            continue
        }

        const issues = []
        if (calificacion === null || calificacion === undefined || String(calificacion) === '0' || String(calificacion) === '') {
            issues.push("Falta 'Calificación Matriz' o es cero")
        }
        if (estado === 'Ejecutada') {
            issues.push(`Estado Administrativo no válido ('${estado}')`)
        }
        if (String(reservada).toUpperCase() === 'SI' || String(reservada) === 'TRUE') {
            issues.push('La ficha está Reservada')
        }

        const geo = extractGeoMeta(row)

        if (issues.length > 0) {
            excepciones.push({ codigoFicha, issues, calificacion, tipoMatriz, estado, ...geo })
        } else {
            const fichaObj = {}
            headers.forEach((h, idx) => {
                fichaObj[String(h).toUpperCase().trim()] = row[idx]
            })
            fichaObj.__geo = geo
            validFichas.push(fichaObj)
        }
    }

    const resultados = []
    const exclusionesPriorizacion = []

    for (const ficha of validFichas) {
        try {
            const { puntajeFinal, detallesPorGrupo, trazaDetallada } = calculateFichaScore(ficha, matrixConfig)
            resultados.push({
                codigo_ficha: ficha['CODIGO FICHA'],
                puntajeFinal,
                detallesPorGrupo,
                trazaDetallada,
                ...(ficha.__geo || {}),
            })
        } catch (e) {
            exclusionesPriorizacion.push({
                codigo_ficha: ficha['CODIGO FICHA'],
                motivo: e.message,
                ...(ficha.__geo || {}),
            })
        }
    }

    return {
        resultados,
        excepciones: [...excepciones, ...exclusionesPriorizacion],
        stats: {
            total_excel: rows.length - 1,
            ignoradas: countIgnored,
            excepciones: excepciones.length + exclusionesPriorizacion.length,
            priorizadas: resultados.length,
        },
    }
}

export const generateExportExcel = (report) => {
    const wb = XLSX.utils.book_new()
    const { resultados, excepciones, stats } = report
    const fechaGeneracion = new Date().toISOString().split('T')[0]

    const totalCal = stats.priorizadas + stats.excepciones
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
        ['PORCENTAJE DE PRIORIZACIÓN', `${totalCal > 0 ? ((stats.priorizadas / totalCal) * 100).toFixed(1) : 0}%`],
        ['PORCENTAJE DE EXCEPCIÓN', `${totalCal > 0 ? ((stats.excepciones / totalCal) * 100).toFixed(1) : 0}%`],
    ]
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData)
    wsResumen['!cols'] = [{ wch: 50 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

    const groupNames = new Set()
    for (const r of resultados) {
        (r.detallesPorGrupo || []).forEach((g) => groupNames.add(g.nombreGrupo))
    }
    const sortedGroups = [...groupNames]

    const prioHeaders = ['Código Ficha', 'Puntaje Final', ...sortedGroups.map((g) => `Pts. ${g}`)]
    const prioRows = [prioHeaders]

    for (const r of resultados) {
        const row = [r.codigo_ficha, r.puntajeFinal]
        for (const gName of sortedGroups) {
            const grupo = (r.detallesPorGrupo || []).find((g) => g.nombreGrupo === gName)
            row.push(grupo ? grupo.puntajePonderado : 0)
        }
        prioRows.push(row)
    }

    const wsPrio = XLSX.utils.aoa_to_sheet(prioRows)
    wsPrio['!cols'] = [{ wch: 20 }, { wch: 14 }, ...sortedGroups.map(() => ({ wch: 22 }))]
    XLSX.utils.book_append_sheet(wb, wsPrio, 'Fichas Priorizadas')

    const detalleHeaders = ['Código Ficha', 'Puntaje Final', 'Grupo', 'Variable', 'Valor Usado', 'Puntaje Variable']
    const detalleRows = [detalleHeaders]
    for (const r of resultados) {
        for (const item of (r.trazaDetallada || [])) {
            detalleRows.push([
                r.codigo_ficha,
                r.puntajeFinal,
                item.nombreGrupo,
                item.nombreVariable || 'N/A',
                item.valorUsado !== undefined && item.valorUsado !== null ? String(item.valorUsado) : 'N/A',
                item.puntajeObtenido,
            ])
        }
    }
    const wsDetalle = XLSX.utils.aoa_to_sheet(detalleRows)
    wsDetalle['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 35 }, { wch: 40 }, { wch: 30 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle Variables')

    const excHeaders = ['Código Ficha', 'Tipo Matriz', 'Calificación', 'Estado', 'Motivos de Rechazo']
    const excRows = [excHeaders]
    for (const exc of excepciones) {
        const code = exc.codigoFicha || exc.codigo_ficha || 'N/A'
        const issues = exc.issues ? exc.issues.join(' | ') : exc.motivo || 'N/A'
        excRows.push([code, exc.tipoMatriz || 'N/A', exc.calificacion || 'N/A', exc.estado || 'N/A', issues])
    }
    const wsExc = XLSX.utils.aoa_to_sheet(excRows)
    wsExc['!cols'] = [{ wch: 20 }, { wch: 55 }, { wch: 14 }, { wch: 18 }, { wch: 50 }]
    XLSX.utils.book_append_sheet(wb, wsExc, 'Excepciones')

    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
