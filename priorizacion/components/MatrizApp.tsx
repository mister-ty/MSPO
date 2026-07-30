"use client"

import React, { useState } from "react"
import * as XLSX from "xlsx"
// @ts-ignore - JS module
import { processRowsLocal, generateExportExcel } from "@/lib/engine-browser"
import Dashboard from "./Dashboard"

const API_URL = "/api/mspo"

const parseExcelFile = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][]
}

const IconUpload = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
)
const IconDownload = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
)
const IconAlert = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
)
const IconCheck = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
    </svg>
)

const MatrizApp: React.FC = () => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [loading, setLoading] = useState(false)
    const [reportData, setReportData] = useState<any>(null)
    const [exporting, setExporting] = useState(false)

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedFile(e.target.files?.[0] ?? null)
        setReportData(null)
    }

    const handleProcessExcel = async () => {
        if (!selectedFile) {
            alert("Por favor selecciona un archivo.")
            return
        }
        setLoading(true)
        try {
            const matrixRes = await fetch(`${API_URL}/matrix/active`)
            if (!matrixRes.ok) {
                const err = await matrixRes.json().catch(() => ({}))
                throw new Error(err.error || `HTTP ${matrixRes.status}`)
            }
            const matrixConfig = await matrixRes.json()

            const rows = await parseExcelFile(selectedFile)
            const reporte = processRowsLocal(rows, matrixConfig)
            setReportData(reporte)

            setTimeout(() => {
                document.getElementById("mspo-resultados-section")?.scrollIntoView({ behavior: "smooth" })
            }, 300)
        } catch (error: any) {
            console.error(error)
            const detail = error?.message || "Error desconocido"
            alert(`Error al procesar el archivo Excel: ${detail}`)
        } finally {
            setLoading(false)
        }
    }

    const handleExportExcel = () => {
        if (!reportData) return
        setExporting(true)
        try {
            const buffer = generateExportExcel(reportData)
            const blob = new Blob([buffer], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            })
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.setAttribute("download", `Reporte_MSPO_${new Date().getTime()}.xlsx`)
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (error) {
            console.error("Error exportando excel:", error)
            alert("No se pudo generar el archivo exportable.")
        } finally {
            setExporting(false)
        }
    }

    return (
        <div className="flex flex-col bg-[#F8F9FB] font-mspo-work selection:bg-mspo-orange selection:text-white">
            <header className="bg-white border-b border-mspo-gray-200 py-4 px-6 sm:px-8 shadow-sm flex items-center justify-between">
                <img src="/mspo/escudo_armas.png" alt="Escudo Medellín" className="h-[60px] object-contain" />
                <span className="text-xs bg-mspo-gray-100 text-mspo-gray-600 px-4 py-2 font-bold rounded border border-mspo-gray-200">
                    MSPO — Módulo de Priorización
                </span>
            </header>

            <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-10 mb-20">
                <div className="mb-10 text-center md:text-left">
                    <h1 className="text-3xl font-mspo-mont font-extrabold text-mspo-navy mb-2">Motor de Priorización (SIRO)</h1>
                    <p className="text-mspo-gray-500">Analiza y prioriza el inventario de solicitudes mediante la Matriz de Priorización Institucional.</p>
                </div>

                <div>
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-mspo-gray-100 mb-8 transition-all hover:shadow-md">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-10 h-10 rounded-full bg-mspo-orange text-white flex items-center justify-center font-bold text-lg">1</div>
                            <h2 className="text-xl font-mspo-mont font-bold text-mspo-navy">Carga de Base SIRO</h2>
                        </div>

                        <p className="text-mspo-gray-600 text-sm mb-6 max-w-2xl">
                            Ajusta el proceso institucional: Sube el archivo Excel exportado del SIRO transaccional para calcular la ponderación automática, determinar viabilidades y aislar excepciones de obra.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                onChange={handleFileChange}
                                className="flex-1 block w-full text-sm text-mspo-gray-600
                                file:mr-4 file:py-3 file:px-6
                                file:rounded-xl file:border-0
                                file:text-sm file:font-bold
                                file:bg-mspo-navy/10 file:text-mspo-navy
                                hover:file:bg-mspo-navy/20 file:cursor-pointer cursor-pointer
                                bg-[#F9FAFB] border border-mspo-gray-200 rounded-xl"
                            />
                            <button
                                onClick={handleProcessExcel}
                                disabled={loading || !selectedFile}
                                className="bg-mspo-navy text-white hover:bg-[#00386B] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-8 py-3 font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all shadow-mspo-navy/20 shrink-0"
                            >
                                <IconUpload /> {loading ? "Calculando Matriz..." : "Procesar Tablero"}
                            </button>
                        </div>
                    </div>

                    {reportData && (
                        <div id="mspo-resultados-section">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                <div className="bg-white p-5 rounded-xl border border-mspo-gray-200 shadow-sm">
                                    <p className="text-[11px] font-bold text-mspo-gray-500 uppercase mb-1">Total Filas</p>
                                    <p className="text-2xl font-mspo-mont font-extrabold text-mspo-navy">{reportData.stats.total_excel}</p>
                                </div>
                                <div className="bg-white p-5 rounded-xl border border-mspo-gray-200 shadow-sm border-l-4 border-l-mspo-blue">
                                    <p className="text-[11px] font-bold text-mspo-gray-500 uppercase mb-1">Ignoradas (No Mantenimiento)</p>
                                    <p className="text-2xl font-mspo-mont font-extrabold text-mspo-gray-800">{reportData.stats.ignoradas}</p>
                                </div>
                                <div className="bg-red-50 p-5 rounded-xl border border-red-100 shadow-sm border-l-4 border-l-red-500">
                                    <p className="text-[11px] font-bold text-red-600 uppercase mb-1">Excepciones</p>
                                    <p className="text-2xl font-mspo-mont font-extrabold text-red-700">{reportData.stats.excepciones}</p>
                                </div>
                                <div className="bg-green-50 p-5 rounded-xl border border-green-100 shadow-sm border-l-4 border-l-green-500">
                                    <p className="text-[11px] font-bold text-green-700 uppercase mb-1">Priorizadas Exitosamente</p>
                                    <p className="text-2xl font-mspo-mont font-extrabold text-green-800">{reportData.stats.priorizadas}</p>
                                </div>
                            </div>

                            <div className="bg-mspo-navy/5 rounded-2xl p-6 sm:p-8 border border-mspo-navy/10 flex flex-col sm:flex-row items-center justify-between gap-6 mb-8">
                                <div>
                                    <h3 className="text-lg font-mspo-mont font-bold text-mspo-navy flex items-center gap-2">
                                        <IconCheck /> Análisis Finalizado Correctamente
                                    </h3>
                                    <p className="text-sm text-mspo-gray-600 mt-2">
                                        Genera el reporte ejecutivo con la traza de las unidades, el ranking final y el log de exclusiones justificado, listo para anexar a la carpeta del contrato.
                                    </p>
                                </div>
                                <button
                                    onClick={handleExportExcel}
                                    disabled={exporting}
                                    className="bg-[#00aeef] text-white hover:bg-[#0089C2] rounded-xl px-8 py-4 font-bold w-full sm:w-auto shadow-md hover:shadow-lg transition-all shrink-0 flex gap-2 items-center justify-center disabled:opacity-50"
                                >
                                    <IconDownload /> {exporting ? "Generando..." : "Descargar Soporte Técnico (XLSX)"}
                                </button>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="bg-white rounded-2xl border border-mspo-gray-200 overflow-hidden shadow-sm">
                                    <div className="bg-mspo-gray-50 border-b border-mspo-gray-200 p-4">
                                        <h4 className="font-bold text-mspo-navy font-mspo-mont">Top 5 Fichas Priorizadas</h4>
                                    </div>
                                    <div className="p-0">
                                        {[...reportData.resultados]
                                            .sort((a: any, b: any) => b.puntajeFinal - a.puntajeFinal)
                                            .slice(0, 5)
                                            .map((r: any, i: number) => (
                                                <div key={i} className="flex justify-between items-center p-4 border-b border-mspo-gray-100 last:border-0 hover:bg-gray-50">
                                                    <span className="font-bold text-mspo-gray-800 text-sm">{r.codigo_ficha}</span>
                                                    <div className={`px-3 py-1 rounded-full text-xs font-bold text-white ${r.puntajeFinal >= 70 ? "bg-green-500" : "bg-mspo-orange"}`}>
                                                        {r.puntajeFinal} Pts
                                                    </div>
                                                </div>
                                            ))}
                                        {reportData.resultados.length === 0 && (
                                            <p className="p-6 text-center text-sm text-mspo-gray-400">No hay fichas priorizadas.</p>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl border border-mspo-gray-200 overflow-hidden shadow-sm">
                                    <div className="bg-red-50 border-b border-red-100 p-4 flex items-center gap-2">
                                        <IconAlert />
                                        <h4 className="font-bold text-red-800 font-mspo-mont">Muestra de Excepciones Detectadas</h4>
                                    </div>
                                    <div className="p-0 max-h-[300px] overflow-y-auto">
                                        {reportData.excepciones.slice(0, 10).map((exc: any, i: number) => (
                                            <div key={i} className="p-4 border-b border-mspo-gray-100 last:border-0 text-sm hover:bg-gray-50">
                                                <span className="font-bold text-mspo-gray-700 block mb-1">{exc.codigoFicha || exc.codigo_ficha || "Sin código"}</span>
                                                <span className="text-red-600 text-xs break-words">
                                                    {exc.issues ? exc.issues.join(", ") : exc.motivo || "Motivo desconocido"}
                                                </span>
                                            </div>
                                        ))}
                                        {reportData.excepciones.length === 0 && (
                                            <p className="p-6 text-center text-sm text-mspo-gray-400">No se detectaron excepciones.</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-10 pt-8 border-t border-mspo-gray-200">
                                <div className="mb-6">
                                    <h3 className="text-2xl font-mspo-mont font-extrabold text-mspo-navy">Dashboard Analítico</h3>
                                    <p className="text-sm text-mspo-gray-500 mt-1">
                                        Visualización integral del proceso: KPIs, embudo de filtrado, distribución de puntajes, aporte por grupo, ranking interactivo y trazabilidad por ficha.
                                    </p>
                                </div>
                                <Dashboard report={reportData} />
                            </div>
                        </div>
                    )}
                </div>
            </main>

            <footer className="bg-white py-6 border-t border-mspo-gray-200 text-center">
                <p className="text-xs font-bold text-mspo-gray-400 uppercase tracking-widest">Módulo de Priorización</p>
                <p className="text-[10px] text-mspo-gray-400 mt-1">Secretaría de Infraestructura Física</p>
            </footer>
        </div>
    )
}

export default MatrizApp
