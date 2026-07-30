"use client"

import React, { useEffect, useMemo, useState } from "react"
// @ts-ignore - JS module
import { generatePDFReport, generateFichaPDF } from "@/lib/pdf-report"
import MapView from "./MapView"

const fmt = (n: any, dec = 2) => {
    if (n === null || n === undefined || isNaN(n)) return '0'
    const num = Number(n)
    return num % 1 === 0 ? num.toLocaleString('es-CO') : num.toFixed(dec)
}

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0)

const median = (arr: number[]) => {
    if (!arr.length) return 0
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const summarizeExcepciones = (excepciones: any[]) => {
    const tally = new Map<string, number>()
    excepciones.forEach((exc) => {
        const motivos = exc.issues && exc.issues.length ? exc.issues : [exc.motivo || 'Motivo no especificado']
        motivos.forEach((m: string) => {
            const key = String(m).trim()
            tally.set(key, (tally.get(key) || 0) + 1)
        })
    })
    return [...tally.entries()]
        .map(([motivo, count]) => ({ motivo, count }))
        .sort((a, b) => b.count - a.count)
}

const SCORE_BUCKETS = [
    { label: '0–20', min: 0, max: 20, color: '#16a34a' },
    { label: '20–40', min: 20, max: 40, color: '#84cc16' },
    { label: '40–60', min: 40, max: 60, color: '#f59e0b' },
    { label: '60–80', min: 60, max: 80, color: '#ea580c' },
    { label: '80–100', min: 80, max: 101, color: '#dc2626' },
]

const bucketize = (scores: number[]) =>
    SCORE_BUCKETS.map((b) => ({
        ...b,
        count: scores.filter((s) => s >= b.min && s < b.max).length,
    }))

const GROUP_COLORS = ['#004884', '#00aeef', '#f47b29', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04']

const scoreColor = (score: number) =>
    score >= 70 ? '#dc2626' : score >= 50 ? '#ea580c' : score >= 30 ? '#f59e0b' : '#16a34a'

const truncate = (s: string, n: number) => {
    if (!s) return ''
    const str = String(s)
    return str.length > n ? str.slice(0, n - 1) + '…' : str
}

const KpiCard: React.FC<{ label: string; value: any; accent?: string; sub?: string }> = ({ label, value, accent = 'navy', sub }) => {
    const accents: Record<string, string> = {
        navy: 'border-l-mspo-navy bg-white',
        blue: 'border-l-mspo-blue bg-white',
        orange: 'border-l-mspo-orange bg-white',
        green: 'border-l-green-500 bg-green-50/40',
        red: 'border-l-red-500 bg-red-50/40',
        gray: 'border-l-mspo-gray-400 bg-white',
    }
    return (
        <div className={`rounded-xl p-4 border border-mspo-gray-200 border-l-4 shadow-sm ${accents[accent]} min-w-0`}>
            <p className="text-[10px] font-bold tracking-wider text-mspo-gray-500 uppercase mb-1 truncate">{label}</p>
            <p className="text-2xl font-mspo-mont font-extrabold text-mspo-navy leading-tight truncate">{value}</p>
            {sub && <p className="text-[11px] text-mspo-gray-500 mt-1 truncate">{sub}</p>}
        </div>
    )
}

const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }> = ({ title, subtitle, children, action, className = '' }) => (
    <div className={`bg-white rounded-2xl border border-mspo-gray-200 p-5 shadow-sm ${className}`}>
        <div className="flex justify-between items-start gap-4 mb-4">
            <div className="min-w-0">
                <h3 className="text-base font-mspo-mont font-bold text-mspo-navy">{title}</h3>
                {subtitle && <p className="text-xs text-mspo-gray-500 mt-1">{subtitle}</p>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
        {children}
    </div>
)

const Funnel: React.FC<{ stats: any }> = ({ stats }) => {
    const total = Math.max(stats.total_excel, 1)
    const filtrables = stats.total_excel - stats.ignoradas
    const stages = [
        { label: 'Total filas', value: stats.total_excel, color: '#004884' },
        { label: 'Unidades de mantenimiento', value: filtrables, color: '#0066b3' },
        { label: 'Sin excepciones', value: stats.priorizadas, color: '#00aeef' },
        { label: 'Priorizadas', value: stats.priorizadas, color: '#16a34a' },
    ]
    return (
        <div className="space-y-2.5">
            {stages.map((s, i) => {
                const w = Math.max((s.value / total) * 100, 2)
                return (
                    <div key={i} className="flex items-center gap-3">
                        <div className="w-40 sm:w-48 shrink-0 text-xs font-semibold text-mspo-gray-700 truncate">{s.label}</div>
                        <div className="flex-1 bg-mspo-gray-100 rounded-md h-7 relative overflow-hidden min-w-0">
                            <div
                                className="h-full transition-all duration-500"
                                style={{ width: `${w}%`, background: s.color }}
                            />
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-white drop-shadow">
                                {fmt(s.value, 0)}
                            </span>
                        </div>
                        <div className="w-14 text-right text-xs font-bold text-mspo-navy shrink-0">
                            {pct(s.value, total).toFixed(1)}%
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

const ScoreHistogram: React.FC<{ scores: number[] }> = ({ scores }) => {
    const buckets = bucketize(scores)
    const max = Math.max(...buckets.map((b) => b.count), 1)
    return (
        <div className="flex items-end gap-3 h-44 pt-4">
            {buckets.map((b, i) => {
                const h = (b.count / max) * 100
                return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                        <span className="text-[11px] font-bold text-mspo-navy mb-1">{b.count}</span>
                        <div
                            className="w-full rounded-t-md transition-all duration-700"
                            style={{ height: `${h}%`, background: b.color, minHeight: b.count > 0 ? '4px' : '0' }}
                            title={`${b.count} fichas en ${b.label}`}
                        />
                        <span className="text-[10px] mt-1 font-semibold text-mspo-gray-600 truncate w-full text-center">{b.label}</span>
                    </div>
                )
            })}
        </div>
    )
}

const GroupAverages: React.FC<{ resultados: any[] }> = ({ resultados }) => {
    const tally = new Map<string, { sum: number; n: number }>()
    resultados.forEach((r) => {
        (r.detallesPorGrupo || []).forEach((g: any) => {
            const cur = tally.get(g.nombreGrupo) || { sum: 0, n: 0 }
            cur.sum += Number(g.puntajePonderado) || 0
            cur.n += 1
            tally.set(g.nombreGrupo, cur)
        })
    })
    const rows = [...tally.entries()]
        .map(([nombre, { sum, n }]) => ({ nombre, avg: n > 0 ? sum / n : 0 }))
        .sort((a, b) => b.avg - a.avg)
    const max = Math.max(...rows.map((r) => r.avg), 1)

    if (!rows.length) {
        return <p className="text-sm text-mspo-gray-400 italic">Sin datos de grupos.</p>
    }
    return (
        <div className="space-y-3">
            {rows.map((r, i) => (
                <div key={r.nombre} className="min-w-0">
                    <div className="flex justify-between items-baseline gap-2 text-[11px] font-semibold text-mspo-gray-700 mb-1">
                        <span className="truncate">{r.nombre}</span>
                        <span className="font-bold text-mspo-navy shrink-0">{r.avg.toFixed(2)} pts</span>
                    </div>
                    <div className="bg-mspo-gray-100 rounded h-3 overflow-hidden">
                        <div
                            className="h-full rounded transition-all duration-500"
                            style={{
                                width: `${Math.max((r.avg / max) * 100, r.avg > 0 ? 2 : 0)}%`,
                                background: GROUP_COLORS[i % GROUP_COLORS.length],
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}

const ExcepcionesDonut: React.FC<{ data: any[] }> = ({ data }) => {
    const total = data.reduce((acc, d) => acc + d.count, 0) || 1
    let acc = 0
    const radius = 60
    const stroke = 20
    const cx = 80
    const cy = 80
    const C = 2 * Math.PI * radius

    return (
        <div className="flex flex-col md:flex-row gap-5 items-center md:items-start">
            <svg width={160} height={160} viewBox="0 0 160 160" className="shrink-0">
                <circle cx={cx} cy={cy} r={radius} stroke="#f1f5f9" strokeWidth={stroke} fill="none" />
                {data.map((d, i) => {
                    const length = (d.count / total) * C
                    const offset = C - acc
                    acc += length
                    return (
                        <circle
                            key={i}
                            cx={cx}
                            cy={cy}
                            r={radius}
                            stroke={GROUP_COLORS[i % GROUP_COLORS.length]}
                            strokeWidth={stroke}
                            fill="none"
                            strokeDasharray={`${length} ${C - length}`}
                            strokeDashoffset={offset}
                            transform={`rotate(-90 ${cx} ${cy})`}
                        />
                    )
                })}
                <text x={cx} y={cy - 2} textAnchor="middle" className="fill-mspo-navy" fontSize="20" fontWeight="800">
                    {total}
                </text>
                <text x={cx} y={cy + 14} textAnchor="middle" className="fill-mspo-gray-400" fontSize="9" fontWeight="600">
                    EXCEPCIONES
                </text>
            </svg>
            <div className="flex-1 space-y-2 w-full min-w-0">
                {data.slice(0, 8).map((d, i) => (
                    <div key={d.motivo} className="flex items-start gap-2 text-xs min-w-0">
                        <span
                            className="w-3 h-3 rounded-sm mt-0.5 shrink-0"
                            style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }}
                        />
                        <span className="flex-1 text-mspo-gray-700 leading-snug break-words min-w-0">{d.motivo}</span>
                        <span className="font-bold text-mspo-navy shrink-0">{d.count}</span>
                        <span className="text-mspo-gray-400 w-12 text-right shrink-0">{((d.count / total) * 100).toFixed(1)}%</span>
                    </div>
                ))}
                {data.length > 8 && (
                    <p className="text-[10px] text-mspo-gray-400 italic">+{data.length - 8} motivos adicionales</p>
                )}
            </div>
        </div>
    )
}

const FichaModal: React.FC<{ ficha: any; exception: any; onClose: () => void }> = ({ ficha, exception, onClose }) => {
    const isException = !!exception

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        window.addEventListener('keydown', onKey)
        document.body.style.overflow = 'hidden'
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.style.overflow = ''
        }
    }, [onClose])

    const handlePdf = async () => {
        try {
            await generateFichaPDF(ficha, isException, exception)
        } catch (e) {
            console.error(e)
            alert('No se pudo generar el PDF de la ficha.')
        }
    }

    const codigo = isException
        ? exception.codigoFicha || exception.codigo_ficha || 'N/A'
        : ficha?.codigo_ficha

    const totalGrupos = ficha
        ? (ficha.detallesPorGrupo || []).reduce((acc: number, g: any) => acc + Number(g.puntajePonderado || 0), 0) || 1
        : 1

    return (
        <div
            className="fixed inset-0 bg-mspo-navy/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className={`px-6 py-5 flex items-start justify-between gap-4 ${
                        isException ? 'bg-gradient-to-r from-red-700 to-red-500' : 'bg-gradient-to-r from-mspo-navy to-mspo-blue'
                    }`}
                >
                    <div className="min-w-0 text-white">
                        <p className="text-[10px] font-bold tracking-wider opacity-80 uppercase">
                            {isException ? 'Excepción detectada' : 'Ficha priorizada'}
                        </p>
                        <h3 className="text-2xl font-mspo-mont font-extrabold leading-tight truncate">{codigo}</h3>
                        {!isException && ficha && (
                            <p className="text-xs opacity-90 mt-1">
                                Puntaje final ponderado calculado a partir de la matriz institucional.
                            </p>
                        )}
                        {isException && exception?.tipoMatriz && (
                            <p className="text-xs opacity-90 mt-1 truncate">Tipo matriz: {exception.tipoMatriz}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        {!isException && ficha && (
                            <div className="text-right text-white">
                                <p className="text-[10px] font-bold opacity-80 uppercase tracking-wider">Puntaje</p>
                                <p className="text-3xl font-mspo-mont font-extrabold leading-none">
                                    {Number(ficha.puntajeFinal).toFixed(2)}
                                </p>
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white text-2xl font-bold w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"
                            aria-label="Cerrar"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto px-6 py-5 space-y-5">
                    {isException ? (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="bg-mspo-gray-50 rounded-lg p-3 border border-mspo-gray-200">
                                    <p className="text-[10px] font-bold text-mspo-gray-500 uppercase">Tipo matriz</p>
                                    <p className="text-sm font-semibold text-mspo-gray-800 mt-1 break-words">{exception.tipoMatriz || '—'}</p>
                                </div>
                                <div className="bg-mspo-gray-50 rounded-lg p-3 border border-mspo-gray-200">
                                    <p className="text-[10px] font-bold text-mspo-gray-500 uppercase">Calificación</p>
                                    <p className="text-sm font-semibold text-mspo-gray-800 mt-1">
                                        {exception.calificacion === null || exception.calificacion === undefined ? '—' : exception.calificacion}
                                    </p>
                                </div>
                                <div className="bg-mspo-gray-50 rounded-lg p-3 border border-mspo-gray-200">
                                    <p className="text-[10px] font-bold text-mspo-gray-500 uppercase">Estado</p>
                                    <p className="text-sm font-semibold text-mspo-gray-800 mt-1">{exception.estado || '—'}</p>
                                </div>
                            </div>
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-mspo-gray-600 mb-2">Motivos de rechazo</p>
                                <ul className="space-y-2">
                                    {(exception.issues || [exception.motivo].filter(Boolean)).map((m: string, i: number) => (
                                        <li
                                            key={i}
                                            className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-800"
                                        >
                                            <span className="w-5 h-5 rounded-full bg-red-200 text-red-800 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                                {i + 1}
                                            </span>
                                            <span className="break-words">{m}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-mspo-gray-600 mb-3">
                                    Aporte por grupo
                                </p>
                                <div className="space-y-3">
                                    {(ficha.detallesPorGrupo || []).map((g: any, i: number) => (
                                        <div key={g.nombreGrupo} className="min-w-0">
                                            <div className="flex justify-between items-baseline gap-2 text-xs font-semibold mb-1">
                                                <span className="text-mspo-gray-800 truncate">{g.nombreGrupo}</span>
                                                <span className="font-bold text-mspo-navy shrink-0">
                                                    {Number(g.puntajePonderado).toFixed(2)} pts
                                                </span>
                                            </div>
                                            <div className="bg-mspo-gray-100 rounded h-2.5 overflow-hidden">
                                                <div
                                                    className="h-full rounded"
                                                    style={{
                                                        width: `${Math.max((Number(g.puntajePonderado) / totalGrupos) * 100, 2)}%`,
                                                        background: GROUP_COLORS[i % GROUP_COLORS.length],
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-mspo-gray-600 mb-2">
                                    Traza variable a variable
                                </p>
                                <div className="rounded-lg border border-mspo-gray-200 overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead className="bg-mspo-navy text-white">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-bold">Grupo</th>
                                                <th className="px-3 py-2 text-left font-bold">Variable</th>
                                                <th className="px-3 py-2 text-left font-bold">Valor usado</th>
                                                <th className="px-3 py-2 text-right font-bold">Pts</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(ficha.trazaDetallada || []).map((t: any, i: number) => (
                                                <tr
                                                    key={i}
                                                    className={i % 2 ? 'bg-mspo-gray-50' : 'bg-white'}
                                                >
                                                    <td className="px-3 py-2 align-top text-mspo-gray-600 break-words max-w-[180px]">
                                                        {t.nombreGrupo}
                                                    </td>
                                                    <td className="px-3 py-2 align-top font-semibold text-mspo-gray-800 break-words max-w-[180px]">
                                                        {t.nombreVariable || 'N/A'}
                                                    </td>
                                                    <td className="px-3 py-2 align-top text-mspo-gray-600 break-words max-w-[200px]">
                                                        {t.valorUsado === null || t.valorUsado === undefined || t.valorUsado === '' ? (
                                                            <span className="italic text-mspo-gray-400">— sin dato —</span>
                                                        ) : (
                                                            String(t.valorUsado)
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 align-top text-right font-bold text-mspo-navy">
                                                        {Number(t.puntajeObtenido).toFixed(0)}
                                                    </td>
                                                </tr>
                                            ))}
                                            {!(ficha.trazaDetallada || []).length && (
                                                <tr>
                                                    <td colSpan={4} className="px-3 py-4 text-center italic text-mspo-gray-400">
                                                        Sin traza disponible.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="px-6 py-4 bg-mspo-gray-50 border-t border-mspo-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p className="text-[11px] text-mspo-gray-500">
                        Información completa según el archivo de soporte exportable.
                    </p>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-mspo-gray-200 text-mspo-gray-700 hover:bg-mspo-gray-100 transition-all"
                        >
                            Cerrar
                        </button>
                        <button
                            onClick={handlePdf}
                            className="px-4 py-2 rounded-lg text-sm font-bold bg-mspo-navy text-white hover:bg-[#00386B] transition-all flex items-center gap-2 shadow-sm flex-1 sm:flex-initial justify-center"
                        >
                            ⬇ Descargar PDF de la ficha
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const RankingTable: React.FC<{ resultados: any[]; onSelect: (r: any) => void; limit?: number }> = ({ resultados, onSelect, limit = 10 }) => {
    const sorted = useMemo(
        () => [...resultados].sort((a, b) => b.puntajeFinal - a.puntajeFinal).slice(0, limit),
        [resultados, limit],
    )
    const max = sorted[0]?.puntajeFinal || 100

    return (
        <div className="divide-y divide-mspo-gray-100">
            {sorted.map((r, i) => {
                const w = (r.puntajeFinal / max) * 100
                return (
                    <button
                        key={r.codigo_ficha}
                        onClick={() => onSelect(r)}
                        className="w-full text-left p-3 flex items-center gap-3 hover:bg-mspo-gray-50 transition-colors group"
                    >
                        <span className="w-6 text-xs font-bold text-mspo-gray-400 text-right shrink-0">{i + 1}</span>
                        <span className="w-32 text-xs font-bold text-mspo-gray-800 truncate shrink-0 group-hover:text-mspo-navy">
                            {r.codigo_ficha}
                        </span>
                        <div className="flex-1 bg-mspo-gray-100 h-2 rounded min-w-0">
                            <div
                                className="h-full rounded transition-all duration-500"
                                style={{ width: `${w}%`, background: scoreColor(r.puntajeFinal) }}
                            />
                        </div>
                        <span className="w-16 text-right text-xs font-bold text-mspo-navy shrink-0">
                            {r.puntajeFinal.toFixed(2)}
                        </span>
                    </button>
                )
            })}
            {sorted.length === 0 && <p className="p-6 text-center text-sm text-mspo-gray-400">Sin priorizadas.</p>}
        </div>
    )
}

type Column = {
    key: string
    label: string
    value: (r: any) => any
    sortValue?: (r: any) => any
    render?: (r: any) => React.ReactNode
    sortable?: boolean
    cellClass?: string
}

const PaginatedTable: React.FC<{
    rows: any[]
    columns: Column[]
    searchKeys: any[]
    emptyMsg: string
    pageSize?: number
    onRowClick?: (r: any) => void
}> = ({ rows, columns, searchKeys, emptyMsg, pageSize = 15, onRowClick }) => {
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)
    const [sortKey, setSortKey] = useState<string | null>(null)
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        let r = rows
        if (q) {
            r = rows.filter((row) =>
                searchKeys.some((k) => {
                    const v = typeof k === 'function' ? k(row) : row[k]
                    return v !== undefined && v !== null && String(v).toLowerCase().includes(q)
                }),
            )
        }
        if (sortKey) {
            const col = columns.find((c) => c.key === sortKey)
            if (col) {
                r = [...r].sort((a, b) => {
                    const va = col.sortValue ? col.sortValue(a) : col.value(a)
                    const vb = col.sortValue ? col.sortValue(b) : col.value(b)
                    if (va === vb) return 0
                    const cmp = va > vb ? 1 : -1
                    return sortDir === 'asc' ? cmp : -cmp
                })
            }
        }
        return r
    }, [rows, search, sortKey, sortDir, columns, searchKeys])

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages - 1)
    const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)

    const onSort = (key: string) => {
        if (sortKey === key) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
        } else {
            setSortKey(key)
            setSortDir('desc')
        }
    }

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between gap-3 mb-3">
                <input
                    type="text"
                    placeholder="Buscar..."
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value)
                        setPage(0)
                    }}
                    className="w-full sm:w-72 bg-mspo-gray-50 border border-mspo-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-mspo-navy/20 focus:outline-none"
                />
                <div className="text-xs text-mspo-gray-500 self-center">
                    {filtered.length.toLocaleString('es-CO')} resultado{filtered.length !== 1 ? 's' : ''}
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-mspo-gray-200">
                <table className="w-full text-sm">
                    <thead className="bg-mspo-gray-50 text-[10px] uppercase tracking-wider text-mspo-navy">
                        <tr>
                            {columns.map((c) => (
                                <th
                                    key={c.key}
                                    className={`px-3 py-2 text-left font-bold whitespace-nowrap ${
                                        c.sortable !== false ? 'cursor-pointer select-none hover:bg-mspo-gray-100' : ''
                                    }`}
                                    onClick={() => c.sortable !== false && onSort(c.key)}
                                >
                                    <span className="inline-flex items-center gap-1">
                                        {c.label}
                                        {sortKey === c.key && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {slice.map((row, i) => (
                            <tr
                                key={i}
                                onClick={() => onRowClick && onRowClick(row)}
                                className={`border-t border-mspo-gray-100 ${onRowClick ? 'cursor-pointer hover:bg-mspo-navy/5' : 'hover:bg-mspo-gray-50'} transition-colors`}
                            >
                                {columns.map((c) => (
                                    <td key={c.key} className={`px-3 py-2 align-top ${c.cellClass || ''}`}>
                                        {c.render ? c.render(row) : c.value(row)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {slice.length === 0 && (
                            <tr>
                                <td className="px-3 py-6 text-center text-xs italic text-mspo-gray-400" colSpan={columns.length}>
                                    {emptyMsg}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-3 text-xs">
                    <span className="text-mspo-gray-500">
                        Página {safePage + 1} de {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(0)}
                            disabled={safePage === 0}
                            className="px-3 py-1 rounded bg-mspo-gray-100 hover:bg-mspo-gray-200 disabled:opacity-40 font-semibold"
                        >
                            «
                        </button>
                        <button
                            onClick={() => setPage(Math.max(0, safePage - 1))}
                            disabled={safePage === 0}
                            className="px-3 py-1 rounded bg-mspo-gray-100 hover:bg-mspo-gray-200 disabled:opacity-40 font-semibold"
                        >
                            ←
                        </button>
                        <button
                            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                            disabled={safePage >= totalPages - 1}
                            className="px-3 py-1 rounded bg-mspo-gray-100 hover:bg-mspo-gray-200 disabled:opacity-40 font-semibold"
                        >
                            →
                        </button>
                        <button
                            onClick={() => setPage(totalPages - 1)}
                            disabled={safePage >= totalPages - 1}
                            className="px-3 py-1 rounded bg-mspo-gray-100 hover:bg-mspo-gray-200 disabled:opacity-40 font-semibold"
                        >
                            »
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

const Dashboard: React.FC<{ report: any }> = ({ report }) => {
    const [view, setView] = useState<'resumen' | 'priorizadas' | 'excepciones' | 'mapa'>('resumen')
    const [selectedFicha, setSelectedFicha] = useState<any>(null)
    const [selectedException, setSelectedException] = useState<any>(null)
    const [exportingPdf, setExportingPdf] = useState(false)

    const { stats, resultados, excepciones } = report
    const scores = useMemo(() => resultados.map((r: any) => Number(r.puntajeFinal) || 0), [resultados])
    const excSummary = useMemo(() => summarizeExcepciones(excepciones), [excepciones])

    const stat = useMemo(() => {
        if (!scores.length) return { avg: 0, max: 0, min: 0, med: 0 }
        const sum = scores.reduce((a: number, b: number) => a + b, 0)
        return {
            avg: sum / scores.length,
            max: Math.max(...scores),
            min: Math.min(...scores),
            med: median(scores),
        }
    }, [scores])

    const totalCalificable = stats.priorizadas + stats.excepciones
    const top = useMemo(() => [...resultados].sort((a: any, b: any) => b.puntajeFinal - a.puntajeFinal), [resultados])

    const groupNames = useMemo(
        () => [...new Set(resultados.flatMap((r: any) => (r.detallesPorGrupo || []).map((g: any) => g.nombreGrupo)))] as string[],
        [resultados],
    )

    const handleDownloadPdf = async () => {
        setExportingPdf(true)
        try {
            await generatePDFReport(report)
        } catch (e) {
            console.error(e)
            alert('No se pudo generar el reporte en PDF.')
        } finally {
            setExportingPdf(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="bg-gradient-to-r from-mspo-navy via-[#005ea3] to-mspo-blue rounded-2xl p-5 sm:p-6 shadow-md flex flex-col sm:flex-row items-center sm:items-stretch gap-4 sm:gap-6">
                <div className="bg-white rounded-xl p-2 shadow-sm shrink-0">
                    <img src="/mspo/escudo_armas.png" alt="Alcaldía de Medellín" className="h-12 sm:h-14 object-contain" />
                </div>
                <div className="flex-1 min-w-0 text-white">
                    <p className="text-[10px] font-bold tracking-widest opacity-80 uppercase">Secretaría de Infraestructura Física</p>
                    <h2 className="text-xl sm:text-2xl font-mspo-mont font-extrabold leading-tight">
                        Dashboard de Priorización
                    </h2>
                    <p className="text-xs sm:text-sm opacity-90 mt-1">
                        Análisis integral del cargue SIRO · Click sobre cualquier ficha para ver su información completa.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
                    <button
                        onClick={handleDownloadPdf}
                        disabled={exportingPdf}
                        className="bg-white text-mspo-navy hover:bg-mspo-gray-100 disabled:opacity-50 font-bold text-sm rounded-lg px-4 py-2.5 shadow-sm transition-all flex items-center gap-2 justify-center whitespace-nowrap"
                    >
                        {exportingPdf ? '⏳ Generando...' : '📄 Descargar PDF'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard label="Total Filas" value={fmt(stats.total_excel, 0)} accent="navy" />
                <KpiCard label="Ignoradas" value={fmt(stats.ignoradas, 0)} accent="gray" sub={`${pct(stats.ignoradas, stats.total_excel).toFixed(1)}% del total`} />
                <KpiCard label="Excepciones" value={fmt(stats.excepciones, 0)} accent="red" sub={`${pct(stats.excepciones, totalCalificable).toFixed(1)}% del calificable`} />
                <KpiCard label="Priorizadas" value={fmt(stats.priorizadas, 0)} accent="green" sub={`${pct(stats.priorizadas, totalCalificable).toFixed(1)}% del calificable`} />
                <KpiCard label="Puntaje Promedio" value={stat.avg.toFixed(2)} accent="blue" sub={`Mediana: ${stat.med.toFixed(2)}`} />
                <KpiCard label="Mejor Puntaje" value={stat.max.toFixed(2)} accent="orange" sub={`Mín: ${stat.min.toFixed(2)}`} />
            </div>

            <div className="flex gap-1 border-b border-mspo-gray-200 overflow-x-auto">
                {[
                    { k: 'resumen', l: 'Resumen analítico' },
                    { k: 'priorizadas', l: `Fichas priorizadas (${resultados.length.toLocaleString('es-CO')})` },
                    { k: 'excepciones', l: `Excepciones (${excepciones.length.toLocaleString('es-CO')})` },
                    { k: 'mapa', l: 'Mapa geográfico' },
                ].map((t) => (
                    <button
                        key={t.k}
                        onClick={() => setView(t.k as any)}
                        className={`px-4 py-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
                            view === t.k
                                ? 'text-mspo-navy border-mspo-navy'
                                : 'text-mspo-gray-400 border-transparent hover:text-mspo-gray-600'
                        }`}
                    >
                        {t.l}
                    </button>
                ))}
            </div>

            {view === 'resumen' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <SectionCard title="Embudo de procesamiento" subtitle="Trazabilidad del filtrado: del Excel crudo a las fichas priorizadas.">
                            <Funnel stats={stats} />
                        </SectionCard>

                        <SectionCard title="Distribución de puntajes" subtitle="Cuántas fichas caen en cada rango de la escala 0–100.">
                            {scores.length > 0 ? (
                                <ScoreHistogram scores={scores} />
                            ) : (
                                <p className="text-sm text-mspo-gray-400 italic py-10 text-center">
                                    No hay fichas priorizadas para construir el histograma.
                                </p>
                            )}
                        </SectionCard>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <SectionCard title="Aporte promedio por grupo" subtitle="Promedio del puntaje ponderado que aporta cada grupo de la matriz.">
                            <GroupAverages resultados={resultados} />
                        </SectionCard>

                        <SectionCard title="Excepciones por motivo" subtitle="Causas que impidieron priorizar una ficha (una ficha puede tener varios motivos).">
                            {excSummary.length ? (
                                <ExcepcionesDonut data={excSummary} />
                            ) : (
                                <p className="text-sm text-mspo-gray-400 italic py-10 text-center">
                                    No se detectaron excepciones.
                                </p>
                            )}
                        </SectionCard>
                    </div>

                    <SectionCard
                        title="Top 10 fichas priorizadas"
                        subtitle="Click en una fila para abrir el detalle completo (aporte por grupo y traza por variable)."
                        action={
                            <button
                                onClick={() => setView('priorizadas')}
                                className="text-xs font-bold text-mspo-blue hover:underline whitespace-nowrap"
                            >
                                Ver todas →
                            </button>
                        }
                    >
                        <RankingTable resultados={resultados} onSelect={setSelectedFicha} limit={10} />
                    </SectionCard>
                </div>
            )}

            {view === 'priorizadas' && (
                <SectionCard
                    title="Listado completo de fichas priorizadas"
                    subtitle="Buscador, orden por columna y click para ver la traza completa de cada ficha."
                >
                    <PaginatedTable
                        rows={top}
                        searchKeys={['codigo_ficha']}
                        emptyMsg="No hay fichas priorizadas."
                        onRowClick={setSelectedFicha}
                        columns={[
                            {
                                key: 'rank',
                                label: '#',
                                value: (r: any) => top.indexOf(r) + 1,
                                sortable: false,
                                cellClass: 'text-mspo-gray-400 font-bold w-10',
                            },
                            {
                                key: 'codigo_ficha',
                                label: 'Código ficha',
                                value: (r: any) => r.codigo_ficha,
                                render: (r: any) => (
                                    <span className="font-bold text-mspo-gray-800 hover:text-mspo-navy">
                                        {r.codigo_ficha}
                                    </span>
                                ),
                            },
                            {
                                key: 'puntajeFinal',
                                label: 'Puntaje',
                                value: (r: any) => r.puntajeFinal,
                                render: (r: any) => (
                                    <span
                                        className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold text-white whitespace-nowrap"
                                        style={{ background: scoreColor(r.puntajeFinal) }}
                                    >
                                        {r.puntajeFinal.toFixed(2)}
                                    </span>
                                ),
                            },
                            ...groupNames.map((gName: string) => ({
                                key: `grp_${gName}`,
                                label: truncate(gName, 22),
                                value: (r: any) => {
                                    const found = (r.detallesPorGrupo || []).find((x: any) => x.nombreGrupo === gName)
                                    return found ? Number(found.puntajePonderado) : 0
                                },
                                sortValue: (r: any) => {
                                    const found = (r.detallesPorGrupo || []).find((x: any) => x.nombreGrupo === gName)
                                    return found ? Number(found.puntajePonderado) : 0
                                },
                                render: (r: any) => {
                                    const found = (r.detallesPorGrupo || []).find((x: any) => x.nombreGrupo === gName)
                                    return (
                                        <span className="text-mspo-gray-700 whitespace-nowrap">
                                            {found ? Number(found.puntajePonderado).toFixed(2) : '—'}
                                        </span>
                                    )
                                },
                            })),
                            {
                                key: 'detalle',
                                label: 'Acción',
                                sortable: false,
                                value: () => '',
                                render: (r: any) => (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setSelectedFicha(r)
                                        }}
                                        className="text-mspo-blue font-semibold text-xs hover:underline whitespace-nowrap"
                                    >
                                        Ver detalle
                                    </button>
                                ),
                            },
                        ]}
                    />
                </SectionCard>
            )}

            {view === 'excepciones' && (
                <div className="space-y-5">
                    <SectionCard title="Distribución por motivo" subtitle="Una ficha puede acumular más de un motivo (Reservada, sin calificación, estado Ejecutada, etc.).">
                        {excSummary.length ? (
                            <ExcepcionesDonut data={excSummary} />
                        ) : (
                            <p className="text-sm text-mspo-gray-400 italic py-6 text-center">No se detectaron excepciones.</p>
                        )}
                    </SectionCard>

                    <SectionCard title="Listado completo de excepciones" subtitle="Click en una fila para ver toda la información de la ficha excluida.">
                        <PaginatedTable
                            rows={excepciones}
                            searchKeys={[
                                (r: any) => r.codigoFicha || r.codigo_ficha,
                                (r: any) => r.tipoMatriz,
                                (r: any) => r.estado,
                                (r: any) => (r.issues ? r.issues.join(' | ') : r.motivo),
                            ]}
                            emptyMsg="No se detectaron excepciones."
                            onRowClick={setSelectedException}
                            columns={[
                                {
                                    key: 'codigo',
                                    label: 'Código',
                                    value: (r: any) => r.codigoFicha || r.codigo_ficha || 'N/A',
                                    render: (r: any) => (
                                        <span className="font-bold text-mspo-gray-800 hover:text-mspo-navy whitespace-nowrap">
                                            {r.codigoFicha || r.codigo_ficha || 'N/A'}
                                        </span>
                                    ),
                                },
                                {
                                    key: 'tipoMatriz',
                                    label: 'Tipo Matriz',
                                    value: (r: any) => r.tipoMatriz || '—',
                                    render: (r: any) => (
                                        <span className="text-xs text-mspo-gray-600 break-words">{r.tipoMatriz || '—'}</span>
                                    ),
                                },
                                {
                                    key: 'calificacion',
                                    label: 'Calif.',
                                    value: (r: any) => (r.calificacion === null || r.calificacion === undefined ? -1 : Number(r.calificacion)),
                                    render: (r: any) => (
                                        <span className="text-xs text-mspo-gray-600 whitespace-nowrap">
                                            {r.calificacion === null || r.calificacion === undefined ? '—' : r.calificacion}
                                        </span>
                                    ),
                                },
                                {
                                    key: 'estado',
                                    label: 'Estado',
                                    value: (r: any) => r.estado || '—',
                                    render: (r: any) => (
                                        <span className="text-xs text-mspo-gray-600 whitespace-nowrap">{r.estado || '—'}</span>
                                    ),
                                },
                                {
                                    key: 'motivos',
                                    label: 'Motivos',
                                    sortable: false,
                                    value: (r: any) => (r.issues ? r.issues.join(' | ') : r.motivo || '—'),
                                    render: (r: any) => (
                                        <div className="flex flex-wrap gap-1">
                                            {(r.issues || [r.motivo].filter(Boolean)).map((m: string, idx: number) => (
                                                <span
                                                    key={idx}
                                                    className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-100"
                                                >
                                                    {m}
                                                </span>
                                            ))}
                                        </div>
                                    ),
                                },
                                {
                                    key: 'detalle',
                                    label: 'Acción',
                                    sortable: false,
                                    value: () => '',
                                    render: (r: any) => (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setSelectedException(r)
                                            }}
                                            className="text-mspo-blue font-semibold text-xs hover:underline whitespace-nowrap"
                                        >
                                            Ver detalle
                                        </button>
                                    ),
                                },
                            ]}
                        />
                    </SectionCard>
                </div>
            )}

            {view === 'mapa' && (
                <SectionCard
                    title="Distribución geográfica de las fichas"
                    subtitle="Cruzamos las coordenadas del Excel SIRO con el resultado de la priorización. Click en un marcador para abrir la ficha completa."
                >
                    <MapView
                        priorizadas={resultados}
                        excepciones={excepciones}
                        onSelectFicha={setSelectedFicha}
                        onSelectException={setSelectedException}
                    />
                </SectionCard>
            )}

            {(selectedFicha || selectedException) && (
                <FichaModal
                    ficha={selectedFicha}
                    exception={selectedException}
                    onClose={() => {
                        setSelectedFicha(null)
                        setSelectedException(null)
                    }}
                />
            )}
        </div>
    )
}

export default Dashboard
