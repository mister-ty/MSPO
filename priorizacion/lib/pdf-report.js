import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const C = {
    navy: [0, 72, 132],
    blue: [0, 174, 239],
    orange: [244, 123, 41],
    green: [22, 163, 74],
    red: [220, 38, 38],
    gray: [102, 102, 102],
    light: [248, 249, 251],
    border: [229, 231, 235],
    text: [40, 47, 60],
}

const setColor = (doc, [r, g, b], type = 'fill') => {
    if (type === 'fill') doc.setFillColor(r, g, b)
    else if (type === 'draw') doc.setDrawColor(r, g, b)
    else doc.setTextColor(r, g, b)
}

const loadImageAsDataURL = async (src) => {
    try {
        const response = await fetch(src)
        const blob = await response.blob()
        return await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
        })
    } catch (err) {
        return null
    }
}

const drawHeader = (doc, logoDataUrl, titulo) => {
    const pageWidth = doc.internal.pageSize.getWidth()

    setColor(doc, C.navy, 'fill')
    doc.rect(0, 0, pageWidth, 22, 'F')

    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, 'PNG', 8, 4, 36, 14)
        } catch (e) { /* noop */ }
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    setColor(doc, [255, 255, 255], 'text')
    doc.text('MSPO — Módulo de Priorización', pageWidth - 12, 11, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(titulo, pageWidth - 12, 17, { align: 'right' })

    setColor(doc, C.orange, 'fill')
    doc.rect(0, 22, pageWidth, 1.4, 'F')
}

const drawFooter = (doc) => {
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const total = doc.internal.getNumberOfPages()

    for (let i = 1; i <= total; i++) {
        doc.setPage(i)
        setColor(doc, C.border, 'draw')
        doc.setLineWidth(0.3)
        doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        setColor(doc, C.gray, 'text')
        doc.text('Secretaría de Infraestructura Física — Alcaldía de Medellín', 10, pageHeight - 6)
        doc.text(`Página ${i} de ${total}`, pageWidth - 10, pageHeight - 6, { align: 'right' })
    }
}

const drawKpiCard = (doc, x, y, w, h, label, value, sub, accent) => {
    setColor(doc, [255, 255, 255], 'fill')
    setColor(doc, C.border, 'draw')
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')

    setColor(doc, accent, 'fill')
    doc.rect(x, y, 1.6, h, 'F')

    setColor(doc, C.gray, 'text')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(label.toUpperCase(), x + 4, y + 5)

    setColor(doc, C.navy, 'text')
    doc.setFontSize(15)
    doc.setFont('helvetica', 'bold')
    doc.text(String(value), x + 4, y + 13)

    if (sub) {
        setColor(doc, C.gray, 'text')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text(sub, x + 4, y + h - 3)
    }
}

const drawSectionTitle = (doc, x, y, title, subtitle) => {
    setColor(doc, C.orange, 'fill')
    doc.rect(x, y - 4, 1.5, 6, 'F')

    setColor(doc, C.navy, 'text')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(title, x + 3.5, y)

    if (subtitle) {
        setColor(doc, C.gray, 'text')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.text(subtitle, x + 3.5, y + 4.2)
        return y + 8
    }
    return y + 4
}

const fmtNum = (n, dec = 2) => {
    if (n === null || n === undefined || isNaN(n)) return '0'
    const num = Number(n)
    return num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: dec })
}

const median = (arr) => {
    if (!arr.length) return 0
    const s = [...arr].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const summarizeExcepciones = (excepciones) => {
    const tally = new Map()
    excepciones.forEach((exc) => {
        const motivos = exc.issues && exc.issues.length ? exc.issues : [exc.motivo || 'Motivo no especificado']
        motivos.forEach((m) => {
            const key = String(m).trim()
            tally.set(key, (tally.get(key) || 0) + 1)
        })
    })
    return [...tally.entries()].map(([motivo, count]) => ({ motivo, count })).sort((a, b) => b.count - a.count)
}

export const generatePDFReport = async (report) => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 10
    const fechaStr = new Date().toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })

    const logo = await loadImageAsDataURL('/mspo/escudo_armas.png')
    const tituloFecha = `Reporte ejecutivo · ${fechaStr}`

    drawHeader(doc, logo, tituloFecha)

    const { stats, resultados, excepciones } = report
    const scores = resultados.map((r) => Number(r.puntajeFinal) || 0)
    const totalCalif = stats.priorizadas + stats.excepciones
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const med = median(scores)
    const max = scores.length ? Math.max(...scores) : 0
    const min = scores.length ? Math.min(...scores) : 0
    const pctPriorizadas = totalCalif > 0 ? (stats.priorizadas / totalCalif) * 100 : 0
    const pctExcepciones = totalCalif > 0 ? (stats.excepciones / totalCalif) * 100 : 0

    let y = drawSectionTitle(doc, margin, 32, 'Resumen ejecutivo', `Generado a partir del cargue SIRO. ${stats.total_excel.toLocaleString('es-CO')} filas analizadas.`)
    y += 2

    const cardW = (pageWidth - margin * 2 - 6) / 3
    const cardH = 18
    drawKpiCard(doc, margin, y, cardW, cardH, 'Total filas', fmtNum(stats.total_excel, 0), 'Origen: cargue SIRO', C.navy)
    drawKpiCard(doc, margin + cardW + 3, y, cardW, cardH, 'Ignoradas', fmtNum(stats.ignoradas, 0), `${(stats.ignoradas / Math.max(stats.total_excel, 1) * 100).toFixed(1)}% del total`, C.gray)
    drawKpiCard(doc, margin + (cardW + 3) * 2, y, cardW, cardH, 'Calificables', fmtNum(totalCalif, 0), 'Tras filtrar no-mantenimiento', C.blue)

    y += cardH + 3
    drawKpiCard(doc, margin, y, cardW, cardH, 'Excepciones', fmtNum(stats.excepciones, 0), `${pctExcepciones.toFixed(1)}% del calificable`, C.red)
    drawKpiCard(doc, margin + cardW + 3, y, cardW, cardH, 'Priorizadas', fmtNum(stats.priorizadas, 0), `${pctPriorizadas.toFixed(1)}% del calificable`, C.green)
    drawKpiCard(doc, margin + (cardW + 3) * 2, y, cardW, cardH, 'Puntaje', `${avg.toFixed(2)} prom`, `Med ${med.toFixed(2)} · Máx ${max.toFixed(2)} · Mín ${min.toFixed(2)}`, C.orange)

    y += cardH + 8

    y = drawSectionTitle(doc, margin, y, 'Distribución de puntajes', 'Cuántas fichas caen en cada rango de la escala 0–100.')
    y += 2

    const buckets = [
        { label: '0–20', min: 0, max: 20, color: C.green },
        { label: '20–40', min: 20, max: 40, color: [132, 204, 22] },
        { label: '40–60', min: 40, max: 60, color: [245, 158, 11] },
        { label: '60–80', min: 60, max: 80, color: C.orange },
        { label: '80–100', min: 80, max: 101, color: C.red },
    ].map((b) => ({ ...b, count: scores.filter((s) => s >= b.min && s < b.max).length }))

    const distMaxBar = Math.max(...buckets.map((b) => b.count), 1)
    const distChartY = y
    const distChartH = 36
    const distChartW = pageWidth - margin * 2
    const colW = (distChartW - 8) / buckets.length

    setColor(doc, [255, 255, 255], 'fill')
    setColor(doc, C.border, 'draw')
    doc.roundedRect(margin, distChartY, distChartW, distChartH + 8, 1.5, 1.5, 'FD')

    buckets.forEach((b, i) => {
        const bx = margin + 4 + colW * i + colW * 0.15
        const bw = colW * 0.7
        const bh = (b.count / distMaxBar) * (distChartH - 8)
        const by = distChartY + (distChartH - bh) - 2

        setColor(doc, b.color, 'fill')
        if (bh > 0) doc.rect(bx, by, bw, Math.max(bh, 1), 'F')

        setColor(doc, C.navy, 'text')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.text(String(b.count), bx + bw / 2, by - 1.5, { align: 'center' })

        setColor(doc, C.gray, 'text')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.text(b.label, bx + bw / 2, distChartY + distChartH + 4, { align: 'center' })
    })

    y = distChartY + distChartH + 12

    const groupTally = new Map()
    resultados.forEach((r) => {
        (r.detallesPorGrupo || []).forEach((g) => {
            const cur = groupTally.get(g.nombreGrupo) || { sum: 0, n: 0 }
            cur.sum += Number(g.puntajePonderado) || 0
            cur.n += 1
            groupTally.set(g.nombreGrupo, cur)
        })
    })
    const groupRows = [...groupTally.entries()]
        .map(([nombre, { sum, n }]) => ({ nombre, avg: n > 0 ? sum / n : 0 }))
        .sort((a, b) => b.avg - a.avg)

    if (groupRows.length) {
        y = drawSectionTitle(doc, margin, y, 'Aporte promedio por grupo', 'Promedio del puntaje ponderado que aporta cada grupo de la matriz.')
        y += 2

        autoTable(doc, {
            startY: y,
            head: [['Grupo', 'Promedio (pts)', 'Distribución']],
            body: groupRows.map((g) => {
                const maxAvg = groupRows[0].avg || 1
                const pctBar = Math.round((g.avg / maxAvg) * 30)
                return [g.nombre, g.avg.toFixed(2), '█'.repeat(pctBar) + '░'.repeat(30 - pctBar)]
            }),
            theme: 'grid',
            headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            bodyStyles: { fontSize: 8, textColor: C.text },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 25, halign: 'right' },
                2: { cellWidth: 'auto', textColor: C.orange, font: 'courier', fontSize: 7 },
            },
            margin: { left: margin, right: margin },
        })

        y = doc.lastAutoTable.finalY + 6
    }

    const excSummary = summarizeExcepciones(excepciones)
    if (excSummary.length) {
        if (y > 230) {
            doc.addPage()
            drawHeader(doc, logo, tituloFecha)
            y = 32
        }
        y = drawSectionTitle(doc, margin, y, 'Excepciones por motivo', 'Causas que impidieron priorizar (una ficha puede tener varios motivos).')
        y += 2

        const totalExc = excSummary.reduce((acc, d) => acc + d.count, 0) || 1
        autoTable(doc, {
            startY: y,
            head: [['Motivo', 'Cantidad', 'Participación']],
            body: excSummary.map((d) => [d.motivo, d.count, `${((d.count / totalExc) * 100).toFixed(1)}%`]),
            theme: 'grid',
            headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            bodyStyles: { fontSize: 8, textColor: C.text },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
                1: { cellWidth: 25, halign: 'right' },
                2: { cellWidth: 30, halign: 'right' },
            },
            margin: { left: margin, right: margin },
        })

        y = doc.lastAutoTable.finalY + 6
    }

    doc.addPage()
    drawHeader(doc, logo, tituloFecha)
    y = 32
    y = drawSectionTitle(doc, margin, y, 'Ranking de fichas priorizadas', `${resultados.length} fichas ordenadas de mayor a menor puntaje.`)
    y += 2

    const ranked = [...resultados].sort((a, b) => b.puntajeFinal - a.puntajeFinal)
    const groupNames = [...new Set(ranked.flatMap((r) => (r.detallesPorGrupo || []).map((g) => g.nombreGrupo)))]
    const groupHeads = groupNames.map((g) => g.length > 22 ? g.slice(0, 22) + '…' : g)

    autoTable(doc, {
        startY: y,
        head: [['#', 'Código ficha', 'Puntaje', ...groupHeads]],
        body: ranked.map((r, i) => {
            const cells = [i + 1, r.codigo_ficha, r.puntajeFinal.toFixed(2)]
            groupNames.forEach((gName) => {
                const g = (r.detallesPorGrupo || []).find((x) => x.nombreGrupo === gName)
                cells.push(g ? Number(g.puntajePonderado).toFixed(2) : '—')
            })
            return cells
        }),
        theme: 'striped',
        headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 7, textColor: C.text },
        alternateRowStyles: { fillColor: C.light },
        columnStyles: {
            0: { cellWidth: 8, halign: 'right', textColor: C.gray },
            1: { cellWidth: 28, fontStyle: 'bold' },
            2: { cellWidth: 16, halign: 'right', textColor: C.orange, fontStyle: 'bold' },
        },
        margin: { left: margin, right: margin },
    })

    if (ranked.length) {
        doc.addPage()
        drawHeader(doc, logo, tituloFecha)
        y = 32
        y = drawSectionTitle(doc, margin, y, 'Detalle variable a variable', 'Traza completa por ficha: grupo, variable, valor usado y puntaje obtenido.')
        y += 2

        const detalleBody = []
        ranked.forEach((r) => {
            (r.trazaDetallada || []).forEach((t, idx) => {
                detalleBody.push([
                    idx === 0 ? r.codigo_ficha : '',
                    idx === 0 ? r.puntajeFinal.toFixed(2) : '',
                    t.nombreGrupo,
                    t.nombreVariable || 'N/A',
                    t.valorUsado === null || t.valorUsado === undefined || t.valorUsado === '' ? '—' : String(t.valorUsado),
                    Number(t.puntajeObtenido).toFixed(0),
                ])
            })
        })

        autoTable(doc, {
            startY: y,
            head: [['Ficha', 'Pts', 'Grupo', 'Variable', 'Valor', 'Pts variable']],
            body: detalleBody,
            theme: 'grid',
            headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
            bodyStyles: { fontSize: 6.8, textColor: C.text, valign: 'top' },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
                0: { cellWidth: 22, fontStyle: 'bold' },
                1: { cellWidth: 12, halign: 'right', textColor: C.orange },
                2: { cellWidth: 38 },
                3: { cellWidth: 38 },
                4: { cellWidth: 50, overflow: 'linebreak' },
                5: { cellWidth: 16, halign: 'right', fontStyle: 'bold' },
            },
            margin: { left: margin, right: margin },
        })
    }

    if (excepciones.length) {
        doc.addPage()
        drawHeader(doc, logo, tituloFecha)
        y = 32
        y = drawSectionTitle(doc, margin, y, 'Bitácora de excepciones', `${excepciones.length} fichas excluidas de la priorización con su motivación.`)
        y += 2

        autoTable(doc, {
            startY: y,
            head: [['Código', 'Tipo matriz', 'Calif.', 'Estado', 'Motivos']],
            body: excepciones.map((exc) => [
                exc.codigoFicha || exc.codigo_ficha || 'N/A',
                exc.tipoMatriz || '—',
                exc.calificacion === null || exc.calificacion === undefined ? '—' : String(exc.calificacion),
                exc.estado || '—',
                exc.issues ? exc.issues.join(' · ') : exc.motivo || '—',
            ]),
            theme: 'grid',
            headStyles: { fillColor: C.red, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
            bodyStyles: { fontSize: 7, textColor: C.text, valign: 'top' },
            alternateRowStyles: { fillColor: [253, 242, 242] },
            columnStyles: {
                0: { cellWidth: 24, fontStyle: 'bold' },
                1: { cellWidth: 50, overflow: 'linebreak' },
                2: { cellWidth: 14, halign: 'right' },
                3: { cellWidth: 22 },
                4: { cellWidth: 'auto', overflow: 'linebreak', textColor: C.red },
            },
            margin: { left: margin, right: margin },
        })
    }

    drawFooter(doc)

    const filename = `Reporte_MSPO_${new Date().toISOString().split('T')[0]}.pdf`
    doc.save(filename)
}

export const generateFichaPDF = async (ficha, isException = false, exceptionData = null) => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 12
    const fechaStr = new Date().toLocaleDateString('es-CO')
    const logo = await loadImageAsDataURL('/mspo/escudo_armas.png')

    drawHeader(doc, logo, `Ficha · ${fechaStr}`)

    let y = 32
    y = drawSectionTitle(doc, margin, y, isException ? 'Excepción detectada' : 'Ficha priorizada', isException ? 'Esta ficha no entró al ranking por las causas listadas.' : 'Detalle completo del puntaje y traza por variable.')
    y += 4

    const codigoFicha = isException ? exceptionData.codigoFicha || exceptionData.codigo_ficha || 'N/A' : ficha.codigo_ficha

    setColor(doc, isException ? C.red : C.navy, 'fill')
    doc.roundedRect(margin, y, pageWidth - margin * 2, 26, 2, 2, 'F')
    setColor(doc, [255, 255, 255], 'text')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('CÓDIGO FICHA', margin + 6, y + 7)
    doc.setFontSize(18)
    doc.text(String(codigoFicha), margin + 6, y + 17)

    if (!isException && ficha) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text('PUNTAJE FINAL', pageWidth - margin - 6, y + 7, { align: 'right' })
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(22)
        doc.text(Number(ficha.puntajeFinal).toFixed(2), pageWidth - margin - 6, y + 19, { align: 'right' })
    }

    y += 32

    if (isException && exceptionData) {
        autoTable(doc, {
            startY: y,
            head: [['Campo', 'Valor']],
            body: [
                ['Tipo de matriz', exceptionData.tipoMatriz || '—'],
                ['Calificación', exceptionData.calificacion === null || exceptionData.calificacion === undefined ? '—' : String(exceptionData.calificacion)],
                ['Estado', exceptionData.estado || '—'],
                ['Motivos de rechazo', exceptionData.issues ? exceptionData.issues.join('\n') : exceptionData.motivo || '—'],
            ],
            theme: 'grid',
            headStyles: { fillColor: C.red, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
            bodyStyles: { fontSize: 9, textColor: C.text, valign: 'top' },
            columnStyles: {
                0: { cellWidth: 50, fontStyle: 'bold', fillColor: C.light },
                1: { cellWidth: 'auto', overflow: 'linebreak' },
            },
            margin: { left: margin, right: margin },
        })
    } else if (ficha) {
        autoTable(doc, {
            startY: y,
            head: [['Grupo', 'Aporte ponderado']],
            body: (ficha.detallesPorGrupo || []).map((g) => [g.nombreGrupo, Number(g.puntajePonderado).toFixed(2)]),
            theme: 'grid',
            headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
            bodyStyles: { fontSize: 9, textColor: C.text },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
                1: { cellWidth: 38, halign: 'right', textColor: C.orange, fontStyle: 'bold' },
            },
            margin: { left: margin, right: margin },
        })

        const afterY = doc.lastAutoTable.finalY + 6

        autoTable(doc, {
            startY: afterY,
            head: [['Grupo', 'Variable', 'Valor usado', 'Pts']],
            body: (ficha.trazaDetallada || []).map((t) => [
                t.nombreGrupo,
                t.nombreVariable || 'N/A',
                t.valorUsado === null || t.valorUsado === undefined || t.valorUsado === '' ? '—' : String(t.valorUsado),
                Number(t.puntajeObtenido).toFixed(0),
            ]),
            theme: 'striped',
            headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            bodyStyles: { fontSize: 8, textColor: C.text, valign: 'top' },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
                0: { cellWidth: 45 },
                1: { cellWidth: 50 },
                2: { cellWidth: 'auto', overflow: 'linebreak' },
                3: { cellWidth: 16, halign: 'right', fontStyle: 'bold', textColor: C.orange },
            },
            margin: { left: margin, right: margin },
        })
    }

    drawFooter(doc)
    doc.save(`Ficha_${codigoFicha}_${new Date().toISOString().split('T')[0]}.pdf`)
}
