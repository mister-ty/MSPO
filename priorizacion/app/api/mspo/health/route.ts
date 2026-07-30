import { NextResponse } from "next/server"
// @ts-ignore - JS module
import { getMspoPool } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

// Chequeo de disponibilidad real: confirma que la función puede alcanzar
// PostgreSQL y autenticarse. Devolver siempre 200 sin tocar la base haría que
// el endpoint reportara "sano" con la base caída, que es justo el escenario
// para el que existe. Se usa para validar TLS y reglas de firewall tras un
// despliegue, así que el error se devuelve textual a propósito.
export async function GET() {
  const started = Date.now()
  try {
    const pool = getMspoPool()
    const { rows } = await pool.query("SELECT 1 AS ok")
    if (rows?.[0]?.ok !== 1) {
      throw new Error("La base respondió, pero con un resultado inesperado.")
    }
    return NextResponse.json(
      { status: "ok", database: "up", latencyMs: Date.now() - started },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error: any) {
    console.error("Health check falló:", error)
    return NextResponse.json(
      {
        status: "error",
        database: "down",
        latencyMs: Date.now() - started,
        detail: error?.message ?? "Error desconocido al conectar con PostgreSQL.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}
