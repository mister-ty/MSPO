import { NextRequest, NextResponse } from "next/server"
import { createRateLimiter, clientIp } from "@/lib/rateLimit"
// @ts-ignore - JS module
import prioritizationService from "@/lib/services/prioritization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const getLimiter = createRateLimiter(60, 60_000)
const postLimiter = createRateLimiter(20, 60_000)
const MAX_BODY_KEYS = 100

export async function GET(req: NextRequest) {
  if (!getLimiter(clientIp(req.headers.get("x-forwarded-for"))).ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 })
  }
  try {
    const url = new URL(req.url)
    const filters: Record<string, any> = {}
    url.searchParams.forEach((value, key) => {
      filters[key] = value
    })
    if (filters.tematica) {
      filters.grupoSolicitud = filters.tematica
    }
    const fichas = await prioritizationService.getFichas(filters)
    return NextResponse.json(fichas)
  } catch (error: any) {
    console.error("Error fetching fichas:", error)
    return NextResponse.json({ error: "Ocurrió un error al obtener las fichas para priorizar" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!postLimiter(clientIp(req.headers.get("x-forwarded-for"))).ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 })
  }
  try {
    const body = await req.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "El body debe ser un objeto JSON." }, { status: 400 })
    }
    if (Object.keys(body).length > MAX_BODY_KEYS) {
      return NextResponse.json(
        { error: `El body excede ${MAX_BODY_KEYS} campos.` },
        { status: 413 },
      )
    }
    const ficha = await prioritizationService.createFicha(body)
    return NextResponse.json(ficha, { status: 201 })
  } catch (error: any) {
    console.error("Error creation ficha:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
