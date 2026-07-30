/**
 * Rate limiter de ventana fija en memoria.
 *
 * ⚠ Limitación: en entornos serverless cada instancia tiene su propio mapa,
 * así que el límite se multiplica por el número de instancias activas. Para
 * producción con tráfico real, sustituir por un store compartido (Redis o
 * equivalente). Suficiente para despliegues single-instance y desarrollo
 * local.
 */

type Bucket = { count: number; windowStart: number };

export function createRateLimiter(max: number, windowMs: number) {
    const buckets = new Map<string, Bucket>();

    return function check(key: string): { ok: boolean } {
        const now = Date.now();
        const b = buckets.get(key);

        if (b && now - b.windowStart < windowMs) {
            if (b.count >= max) return { ok: false };
            b.count++;
            return { ok: true };
        }

        buckets.set(key, { count: 1, windowStart: now });
        return { ok: true };
    };
}

/** Extrae la primera IP de `x-forwarded-for` (el resto son proxies intermedios). */
export function clientIp(headerValue: string | null): string {
    if (!headerValue) return "unknown";
    const first = headerValue.split(",")[0]?.trim();
    return first || "unknown";
}
