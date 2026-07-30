import { NextRequest, NextResponse } from "next/server"
import { createRateLimiter, clientIp } from "@/lib/rateLimit"
// @ts-ignore - JS module
import excelService from "@/lib/services/excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const limiter = createRateLimiter(30, 60_000)

export async function POST(req: NextRequest) {
  if (!limiter(clientIp(req.headers.get("x-forwarded-for"))).ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 })
  }
  try {
    const body = await req.json().catch(() => null)
    const report = body?.report
    if (!report || !report.stats) {
      return NextResponse.json({ error: 'Se requiere el objeto "report".' }, { status: 400 })
    }

    const excelBuffer: Buffer = excelService.generateExportExcel(report)
    const fecha = new Date().toISOString().split("T")[0]
    const filename = `Reporte_Priorizacion_MSPO_${fecha}.xlsx`

    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting from report:", error)
    return NextResponse.json({ error: "Ocurrió un error al generar el reporte Excel." }, { status: 500 })
  }
}
