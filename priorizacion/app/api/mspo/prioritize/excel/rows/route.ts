import { NextRequest, NextResponse } from "next/server"
import { createRateLimiter, clientIp } from "@/lib/rateLimit"
// @ts-ignore - JS module
import excelService from "@/lib/services/excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const MAX_ROWS = 10_000
const limiter = createRateLimiter(30, 60_000)

export async function POST(req: NextRequest) {
  if (!limiter(clientIp(req.headers.get("x-forwarded-for"))).ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 })
  }
  try {
    const body = await req.json().catch(() => null)
    const rows = body?.rows
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: 'Se requiere un arreglo "rows".' }, { status: 400 })
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `El arreglo "rows" excede el límite de ${MAX_ROWS.toLocaleString("es-CO")} filas.` },
        { status: 413 },
      )
    }
    const reporte = await excelService.processRows(rows)
    return NextResponse.json(reporte)
  } catch (error: any) {
    console.error("Error processing rows JSON:", error)
    return NextResponse.json({ error: "Ocurrió un error al procesar las filas." }, { status: 500 })
  }
}
