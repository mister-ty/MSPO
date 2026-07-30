/** @type {import('next').NextConfig} */

// CSP en modo *report-only* a propósito. La app necesita estilos inline
// (Tailwind + Leaflet), imágenes `data:`/`blob:` (jsPDF y html2canvas) y los
// tiles de OpenStreetMap, así que una política estricta es fácil de romper sin
// darse cuenta. En report-only las violaciones aparecen en la consola del
// navegador sin bloquear nada: revisar el mapa y la exportación a PDF y, cuando
// esté limpio, renombrar la cabecera a `Content-Security-Policy`.
const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ');

const securityHeaders = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    // Vercel sirve siempre por HTTPS, así que HSTS no puede dejar fuera a nadie.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'Content-Security-Policy-Report-Only', value: csp },
];

const nextConfig = {
    // No anunciar el framework ni su presencia en cada respuesta.
    poweredByHeader: false,
    // `pg` abre sockets TCP y no debe pasar por el bundler. En Next 14 la clave
    // vive todavía bajo `experimental`; se llama `serverExternalPackages` sólo
    // a partir de Next 15.
    experimental: {
        serverComponentsExternalPackages: ['pg'],
    },
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }];
    },
};

module.exports = nextConfig
