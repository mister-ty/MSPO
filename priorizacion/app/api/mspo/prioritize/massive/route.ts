import { NextRequest, NextResponse } from "next/server"
import { createRateLimiter, clientIp } from "@/lib/rateLimit"
// @ts-ignore - JS module
import prioritizationService from "@/lib/services/prioritization"
// @ts-ignore - JS module
import siroRepository from "@/lib/repositories/siro"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Sin esto la ruta heredaba el valor por defecto de la plataforma. Con hasta
// 10.000 códigos y escrituras fila por fila contra Azure, este flujo necesita
// el techo completo que permite el plan Hobby (300 s).
export const maxDuration = 300

const MAX_CODIGOS = 10_000
const limiter = createRateLimiter(20, 60_000)

export async function POST(req: NextRequest) {
  if (!limiter(clientIp(req.headers.get("x-forwarded-for"))).ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 })
  }
  try {
    const { codigos } = await req.json()
    if (!codigos || !Array.isArray(codigos) || codigos.length === 0) {
      return NextResponse.json({ error: "Se requiere un array de códigos de ficha" }, { status: 400 })
    }
    if (codigos.length > MAX_CODIGOS) {
      return NextResponse.json(
        { error: `Excede el límite de ${MAX_CODIGOS.toLocaleString("es-CO")} códigos por petición.` },
        { status: 413 },
      )
    }

    const fichasData = await siroRepository.findPrioritizableFichas({ codigos })

    if (fichasData.length === 0 && codigos.length > 0) {
      const results = await prioritizationService.runMassivePrioritization([], "admin", codigos)
      return NextResponse.json(results, { status: 201 })
    }

    const user = "admin"
    const results = await prioritizationService.runMassivePrioritization(fichasData, user, codigos)
    return NextResponse.json(results, { status: 201 })
  } catch (error: any) {
    console.error("Error in massive prioritization:", error)
    return NextResponse.json({ error: "Error durante la priorización masiva" }, { status: 500 })
  }
}
