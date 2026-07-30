import { NextRequest, NextResponse } from "next/server"
import { createRateLimiter, clientIp } from "@/lib/rateLimit"
// @ts-ignore - JS module
import excelService from "@/lib/services/excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// 4 MB, por debajo del techo de 4.5 MB que Vercel aplica al cuerpo de la
// petición. Con 5 MB la plataforma devolvía un 413 propio antes de llegar aquí,
// así que el mensaje de abajo nunca se veía para archivos de 4.5–5 MB.
const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4 MB
const limiter = createRateLimiter(20, 60_000) // 20 uploads/min/IP

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
    return NextResponse.json(reporte)
  } catch (error: any) {
    console.error("Error processing Excel upload:", error)
    return NextResponse.json({ error: "Ocurrió un error al procesar el archivo Excel." }, { status: 500 })
  }
}
