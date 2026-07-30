"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import type LType from "leaflet"

const scoreColor = (score: number) =>
    score >= 70 ? '#dc2626' : score >= 50 ? '#ea580c' : score >= 30 ? '#f59e0b' : '#16a34a'

const SCORE_RANGES = [
    { k: 'r0', label: '0–20', min: 0, max: 20, color: '#16a34a' },
    { k: 'r1', label: '20–40', min: 20, max: 40, color: '#84cc16' },
    { k: 'r2', label: '40–60', min: 40, max: 60, color: '#f59e0b' },
    { k: 'r3', label: '60–80', min: 60, max: 80, color: '#ea580c' },
    { k: 'r4', label: '80–100', min: 80, max: 101, color: '#dc2626' },
]

const inRange = (score: number, key: string) => {
    const r = SCORE_RANGES.find((x) => x.k === key)
    if (!r) return true
    return score >= r.min && score < r.max
}

const markerIcon = (color: string, label: string | number) => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
  <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26s18-12.5 18-26C36 8.06 27.94 0 18 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <circle cx="18" cy="18" r="9" fill="#ffffff"/>
  <text x="18" y="22" text-anchor="middle" font-size="9" font-weight="700" font-family="Arial, sans-serif" fill="${color}">${label}</text>
</svg>`
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const exceptionIcon = () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
  <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="#6b7280" stroke="#ffffff" stroke-width="2"/>
  <text x="16" y="22" text-anchor="middle" font-size="14" font-weight="700" font-family="Arial, sans-serif" fill="#ffffff">!</text>
</svg>`
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

type Props = {
    priorizadas: any[]
    excepciones: any[]
    onSelectFicha?: (f: any) => void
    onSelectException?: (e: any) => void
}

const MapView: React.FC<Props> = ({ priorizadas, excepciones, onSelectFicha, onSelectException }) => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const mapRef = useRef<LType.Map | null>(null)
    const leafletRef = useRef<typeof LType | null>(null)
    const markersRef = useRef<LType.Marker[]>([])

    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [filter, setFilter] = useState<'all' | 'priorizadas' | 'excepciones' | 'top'>('all')
    const [rangeFilter, setRangeFilter] = useState<string>('all')

    const priorizadasGeo = useMemo(() => priorizadas.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number'), [priorizadas])
    const excepcionesGeo = useMemo(() => excepciones.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number'), [excepciones])

    const totalSinCoords =
        priorizadas.length - priorizadasGeo.length + excepciones.length - excepcionesGeo.length

    useEffect(() => {
        let cancelled = false

        import('leaflet')
            .then((mod) => {
                if (cancelled) return
                if (!containerRef.current) return
                if (mapRef.current) return

                const L = mod.default
                leafletRef.current = L

                const points = [...priorizadasGeo, ...excepcionesGeo]
                const center: [number, number] =
                    points.length > 0 ? [points[0].lat, points[0].lng] : [6.2476, -75.5658]

                const map = L.map(containerRef.current, {
                    center,
                    zoom: points.length > 0 ? 12 : 11,
                })

                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    maxZoom: 19,
                }).addTo(map)

                mapRef.current = map
                setStatus('ready')
            })
            .catch((err: any) => {
                console.error('No se pudo cargar el mapa:', err)
                setError(err?.message || 'Error cargando el mapa')
                setStatus('error')
            })

        return () => {
            cancelled = true
            if (mapRef.current) {
                mapRef.current.remove()
                mapRef.current = null
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const rangeCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        SCORE_RANGES.forEach((r) => {
            counts[r.k] = priorizadasGeo.filter((p) => p.puntajeFinal >= r.min && p.puntajeFinal < r.max).length
        })
        return counts
    }, [priorizadasGeo])

    const visiblePriorizadas = useMemo(() => {
        if (filter === 'excepciones') return []
        let base = priorizadasGeo
        if (filter === 'top') {
            base = [...priorizadasGeo].sort((a, b) => b.puntajeFinal - a.puntajeFinal).slice(0, 20)
        }
        if (rangeFilter !== 'all') {
            base = base.filter((p) => inRange(p.puntajeFinal, rangeFilter))
        }
        return base
    }, [priorizadasGeo, filter, rangeFilter])

    const visibleExcepciones = useMemo(() => {
        if (filter === 'priorizadas' || filter === 'top') return []
        if (rangeFilter !== 'all') return []
        return excepcionesGeo
    }, [excepcionesGeo, filter, rangeFilter])

    useEffect(() => {
        if (status !== 'ready' || !mapRef.current || !leafletRef.current) return
        const L = leafletRef.current
        const map = mapRef.current

        markersRef.current.forEach((m) => m.remove())
        markersRef.current = []

        const bounds = L.latLngBounds([])

        visiblePriorizadas.forEach((p) => {
            const icon = L.icon({
                iconUrl: markerIcon(scoreColor(p.puntajeFinal), Math.round(p.puntajeFinal)),
                iconSize: [36, 44],
                iconAnchor: [18, 44],
                popupAnchor: [0, -40],
            })
            const marker = L.marker([p.lat, p.lng], {
                icon,
                title: `${p.codigo_ficha} · ${p.puntajeFinal.toFixed(2)} pts`,
            }).addTo(map)

            const html = `
                <div style="font-family: 'Work Sans', sans-serif; min-width: 220px; max-width: 260px;">
                    <div style="font-size:10px; color:#6b7280; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Ficha priorizada</div>
                    <div style="font-size:18px; font-weight:800; color:#004884; margin:2px 0 6px;">${p.codigo_ficha}</div>
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <span style="background:${scoreColor(p.puntajeFinal)}; color:white; padding:3px 10px; border-radius:999px; font-weight:700; font-size:12px;">
                            ${p.puntajeFinal.toFixed(2)} pts
                        </span>
                    </div>
                    ${p.direccion ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;"><b>Dirección:</b> ${p.direccion}</div>` : ''}
                    ${p.comuna ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;"><b>Comuna:</b> ${p.comuna}</div>` : ''}
                    ${p.barrio ? `<div style="font-size:11px;color:#374151;margin-bottom:6px;"><b>Barrio:</b> ${p.barrio}</div>` : ''}
                    <button id="mspo-iw-detail" style="background:#004884;color:white;font-weight:700;font-size:12px;padding:6px 12px;border:none;border-radius:8px;cursor:pointer;width:100%;">
                        Ver detalle completo
                    </button>
                </div>`
            marker.bindPopup(html)
            marker.on('popupopen', () => {
                const btn = document.getElementById('mspo-iw-detail')
                if (btn) btn.onclick = () => {
                    marker.closePopup()
                    onSelectFicha && onSelectFicha(p)
                }
            })

            markersRef.current.push(marker)
            bounds.extend([p.lat, p.lng])
        })

        visibleExcepciones.forEach((e) => {
            const icon = L.icon({
                iconUrl: exceptionIcon(),
                iconSize: [32, 40],
                iconAnchor: [16, 40],
                popupAnchor: [0, -36],
            })
            const marker = L.marker([e.lat, e.lng], {
                icon,
                title: `${e.codigoFicha || e.codigo_ficha} · Excepción`,
            }).addTo(map)

            const motivos = e.issues ? e.issues : (e.motivo ? [e.motivo] : [])
            const html = `
                <div style="font-family:'Work Sans',sans-serif;min-width:220px;max-width:260px;">
                    <div style="font-size:10px;color:#dc2626;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Excepción detectada</div>
                    <div style="font-size:18px;font-weight:800;color:#7f1d1d;margin:2px 0 6px;">${e.codigoFicha || e.codigo_ficha || 'N/A'}</div>
                    ${motivos.map((m: string) => `<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:4px 8px;border-radius:6px;font-size:11px;margin-bottom:4px;">${m}</div>`).join('')}
                    ${e.direccion ? `<div style="font-size:11px;color:#374151;margin-top:4px;"><b>Dirección:</b> ${e.direccion}</div>` : ''}
                    <button id="mspo-iw-exc" style="background:#7f1d1d;color:white;font-weight:700;font-size:12px;padding:6px 12px;border:none;border-radius:8px;cursor:pointer;width:100%;margin-top:8px;">
                        Ver detalle completo
                    </button>
                </div>`
            marker.bindPopup(html)
            marker.on('popupopen', () => {
                const btn = document.getElementById('mspo-iw-exc')
                if (btn) btn.onclick = () => {
                    marker.closePopup()
                    onSelectException && onSelectException(e)
                }
            })

            markersRef.current.push(marker)
            bounds.extend([e.lat, e.lng])
        })

        if (markersRef.current.length > 0 && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [60, 60] })
            if (map.getZoom() > 16) map.setZoom(15)
        }
    }, [status, visiblePriorizadas, visibleExcepciones, onSelectFicha, onSelectException])

    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                    {[
                        { k: 'all', l: `Todas (${priorizadasGeo.length + excepcionesGeo.length})`, color: 'bg-mspo-navy' },
                        { k: 'priorizadas', l: `Priorizadas (${priorizadasGeo.length})`, color: 'bg-mspo-blue' },
                        { k: 'top', l: 'Top 20', color: 'bg-red-600' },
                        { k: 'excepciones', l: `Excepciones (${excepcionesGeo.length})`, color: 'bg-gray-600' },
                    ].map((opt) => (
                        <button
                            key={opt.k}
                            onClick={() => setFilter(opt.k as any)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all ${
                                filter === opt.k
                                    ? `${opt.color} text-white shadow-sm`
                                    : 'bg-mspo-gray-100 text-mspo-gray-600 hover:bg-mspo-gray-200'
                            }`}
                        >
                            {opt.l}
                        </button>
                    ))}
                </div>

                <div className="text-xs text-mspo-gray-500 flex items-center gap-3 flex-wrap">
                    <span className="font-bold text-mspo-gray-600 uppercase tracking-wider text-[10px]">Prioridad:</span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full" style={{ background: '#dc2626' }}></span> ≥70 alta
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full" style={{ background: '#ea580c' }}></span> 50–69
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full" style={{ background: '#f59e0b' }}></span> 30–49
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full" style={{ background: '#16a34a' }}></span> &lt;30 baja
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full bg-gray-500"></span> Excep.
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center bg-mspo-gray-50 border border-mspo-gray-200 rounded-lg px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-mspo-gray-600 mr-1">
                    Filtrar por rango de puntaje:
                </span>
                <button
                    onClick={() => setRangeFilter('all')}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-all ${
                        rangeFilter === 'all'
                            ? 'bg-mspo-navy text-white shadow-sm'
                            : 'bg-white border border-mspo-gray-200 text-mspo-gray-600 hover:bg-mspo-gray-100'
                    }`}
                >
                    Todos ({priorizadasGeo.length})
                </button>
                {SCORE_RANGES.map((r) => {
                    const active = rangeFilter === r.k
                    const count = rangeCounts[r.k] || 0
                    return (
                        <button
                            key={r.k}
                            onClick={() => setRangeFilter(active ? 'all' : r.k)}
                            disabled={count === 0}
                            title={count === 0 ? 'Sin fichas en este rango' : `${count} fichas con puntaje ${r.label}`}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-all flex items-center gap-1.5 ${
                                active
                                    ? 'text-white shadow-sm'
                                    : count === 0
                                        ? 'bg-white border border-mspo-gray-100 text-mspo-gray-300 cursor-not-allowed'
                                        : 'bg-white border border-mspo-gray-200 text-mspo-gray-700 hover:bg-mspo-gray-100'
                            }`}
                            style={active ? { background: r.color } : undefined}
                        >
                            <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ background: active ? '#ffffff' : r.color, opacity: count === 0 ? 0.3 : 1 }}
                            />
                            {r.label}
                            <span className={`text-[10px] font-semibold ${active ? 'text-white/90' : 'text-mspo-gray-400'}`}>
                                ({count})
                            </span>
                        </button>
                    )
                })}
            </div>

            <div className="relative">
                <div
                    ref={containerRef}
                    className="w-full rounded-2xl border border-mspo-gray-200 overflow-hidden bg-mspo-gray-100"
                    style={{ height: 'min(70vh, 600px)' }}
                />
                {status === 'loading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-2xl">
                        <div className="text-center">
                            <div className="w-10 h-10 border-4 border-mspo-navy border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-sm font-bold text-mspo-navy">Cargando mapa...</p>
                        </div>
                    </div>
                )}
                {status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/95 rounded-2xl">
                        <div className="text-center max-w-sm px-6">
                            <p className="text-3xl mb-2">🗺️</p>
                            <p className="text-sm font-bold text-red-700 mb-1">No fue posible cargar el mapa</p>
                            <p className="text-xs text-mspo-gray-500">{error}</p>
                            <p className="text-xs text-mspo-gray-400 mt-2">
                                Verifica tu conexión a internet e intenta de nuevo.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {(priorizadasGeo.length === 0 && excepcionesGeo.length === 0) ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                    <p className="font-bold mb-1">⚠ El archivo no contiene coordenadas geográficas detectables.</p>
                    <p className="text-xs">
                        Se buscaron columnas con encabezados como <span className="font-mono bg-white px-1 rounded">LATITUD</span>,{' '}
                        <span className="font-mono bg-white px-1 rounded">LONGITUD</span>,{' '}
                        <span className="font-mono bg-white px-1 rounded">LAT</span> o{' '}
                        <span className="font-mono bg-white px-1 rounded">LNG</span>. Asegúrate de exportar el SIRO incluyéndolas.
                    </p>
                </div>
            ) : totalSinCoords > 0 ? (
                <p className="text-xs text-mspo-gray-500">
                    {totalSinCoords.toLocaleString('es-CO')} fichas no se muestran porque carecen de coordenadas válidas en el Excel de origen.
                </p>
            ) : null}
        </div>
    )
}

export default MapView
