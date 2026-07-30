import { NextRequest, NextResponse } from "next/server"
import { createRateLimiter, clientIp } from "@/lib/rateLimit"
// @ts-ignore - JS module
import excelService from "@/lib/services/excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// 4 MB, por debajo del techo de 4.5 MB de Vercel para el cuerpo de la petición.
// Ojo: el mismo límite aplica a la *respuesta*, y la hoja "Detalle Variables"
// emite una fila por variable por ficha, así que un lote grande puede pasarse
// aunque la entrada quepa.
const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4 MB
const limiter = createRateLimiter(20, 60_000)

export async function POST(req: NextRequest) {
  if (!limiter(clientIp(req.headers.get("x-forwarded-for"))).ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 })
  }
  try {
    const form = await req.formData()
    const file = form.get("archivoSIRO") as File | null
    if (!file) {
      return NextResponse.json({ error: "No se subió ningún archivo Excel." }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `Archivo excede el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      )
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const reporte = await excelService.processExcel(buffer)
    const excelBuffer: Buffer = excelService.generateExportExcel(reporte)
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
    console.error("Error exporting Excel:", error)
    return NextResponse.json({ error: "Ocurrió un error al generar el reporte Excel." }, { status: 500 })
  }
}
