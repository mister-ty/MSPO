import { NextResponse } from "next/server"
// @ts-ignore - JS module
import mspoRepository from "@/lib/repositories/mspo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const matrix = await mspoRepository.getActiveMatrixConfiguration()
    if (!matrix) return NextResponse.json({ error: "No hay matriz activa configurada." }, { status: 404 })
    return NextResponse.json(matrix)
  } catch (error: any) {
    console.error("Error fetching active matrix:", error)
    return NextResponse.json({ error: "Error al obtener la matriz activa" }, { status: 500 })
  }
}
