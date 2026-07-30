# Matriz de Priorización (MSPO)

Aplicación Next.js para priorizar fichas SIRO según una matriz institucional configurable: se sube un Excel, se calcula un puntaje ponderado por ficha (con trazabilidad completa) y se visualizan los resultados en un dashboard y un mapa.

## Stack

- **Next.js 14** (App Router) + React 18 + TypeScript
- **Tailwind CSS** para estilos
- **PostgreSQL** como base de datos (vía `pg`)
- **Leaflet** + OpenStreetMap para el mapa
- **xlsx** (lectura/escritura de Excel) y **jsPDF** (reportes PDF)

---

## 1. Estructura del proyecto

```
priorizacion/
├── app/                        Next.js App Router
│   ├── page.tsx                 Redirige "/" → "/matriz"
│   ├── layout.tsx                Layout raíz (título, HTML base)
│   ├── globals.css               Tailwind + CSS de Leaflet
│   ├── matriz/
│   │   └── page.tsx              Página principal de la app (monta <MatrizApp />)
│   └── api/mspo/                 API routes (backend)
│       ├── health/                    Healthcheck simple
│       ├── fichas/                    GET (listar/filtrar) y POST (crear ficha SIRO)
│       ├── matrix/active/             GET la matriz institucional activa
│       └── prioritize/
│           ├── excel/                 POST: sube un Excel y calcula la priorización
│           ├── excel/rows/            POST: calcula sobre filas ya parseadas (sin archivo)
│           ├── excel/export/          POST: genera el Excel de reporte a partir de un resultado ya calculado
│           ├── excel/file/export/     POST: sube un Excel y devuelve directo el reporte exportado
│           └── massive/               POST: priorización masiva por códigos de ficha (lee de la BD)
│
├── components/                 Componentes de UI (cliente)
│   ├── MatrizApp.tsx             Orquestador: carga de Excel, estado global de la vista
│   ├── Dashboard.tsx             Tablero de resultados, KPIs, tablas, exportación
│   └── MapView.tsx               Mapa Leaflet con marcadores por ficha/excepción
│
├── lib/                         Lógica de servidor (no se envía al navegador)
│   ├── db.js                     Cliente PostgreSQL (pool + shim de transacciones)
│   ├── rateLimit.ts               Rate limiting simple en memoria por IP
│   ├── engine-browser.js          Motor de cálculo usado en el navegador (preview antes de subir)
│   ├── pdf-report.js              Generación de reportes PDF (jsPDF)
│   ├── repositories/
│   │   ├── siro.js                 Acceso a tablas `siro_*` (fichas, resultados vigentes)
│   │   └── mspo.js                 Acceso a tablas `mspo_*` (config de matriz, bitácora)
│   └── services/
│       ├── excel.js                Parseo de Excel, reglas de exclusión, export de reportes
│       └── prioritization.js       Motor de cálculo del puntaje (lado servidor)
│
├── public/mspo/                 Assets estáticos (imágenes, escudo)
├── .env                          Variables de entorno (NO se sube a git)
├── package.json
├── tailwind.config.js / postcss.config.js / next.config.js / tsconfig.json
└── README.md                     Este archivo
```

### Dónde vive la base de datos

El **esquema SQL** (tablas, índices, vista, y la carga inicial de la matriz activa) **no está dentro de este proyecto** — es un archivo aparte que se ejecuta manualmente contra PostgreSQL:

```
mpo.sql
```

Ese script crea las 9 tablas + 1 vista (`siro_*`, `mspo_*`) y, al final, inserta una matriz activa de ejemplo (pesos: Calificación 30%, Cercanía 15%, Amenazas 25%, Afectación 15%, Demanda 10%, Antigüedad 5%). para que la plataforma funcione correctamente apartir de esa matriz de ejemplo, Ver la sección 3 para cómo correrlo.

---

## 2. Variables de entorno

Archivo `.env` en la raíz del proyecto (ya existe en local, con datos de ejemplo — **no se versiona en git**):

| Variable    | Para qué sirve                                          | Ejemplo (local) |
|-------------|-----------------------------------------------------------|------------------|
| `PGHOST`     | Host del servidor PostgreSQL                              | `localhost` |
| `PGPORT`     | Puerto de PostgreSQL                                       | `5432` |
| `PGDATABASE` | Nombre de la base de datos                                  | `mpo` |
| `PGUSER`     | Usuario de PostgreSQL                                       | `postgres` |
| `PGPASSWORD` | Password de ese usuario                                     | `••••••••` |

No hay más variables requeridas — el mapa usa Leaflet + OpenStreetMap, que no necesita API key.

En **producción**, estas mismas 5 variables se configuran como variables de entorno reales del servidor/plataforma de hosting (no copiando el `.env` de tu máquina), apuntando al Postgres de producción.

---

## 3. Desplegar en local

### Requisitos previos
- Node.js 18+ y npm
- PostgreSQL corriendo localmente (o accesible por red)

### Pasos

**1. Instalar dependencias**
```bash
npm install
```

**2. Crear la base de datos**

Manualmente, con `psql`, pgAdmin o el cliente que prefieras:
```sql
CREATE DATABASE mpo;
```

**3. Cargar el esquema + configuración inicial**

Corre el script independiente (crea tablas, vista, y la matriz activa de ejemplo):
```bash
psql -h localhost -U postgres -d mpo -f "mpo.sql"
```
O pega su contenido en el editor SQL de pgAdmin y ejecútalo. solo debe correrse **una vez** — si la corres dos veces sobre una base que ya tiene una matriz activa, va a fallar por la restricción de "una sola matriz activa" (es intencional).

> Los pesos que trae el script son de **ejemplo**. Edítalos directamente en `mpo.sql` (sección `BLOQUE 4`) con los valores reales de tu matriz institucional antes de usar la app en serio.

**4. Configurar `.env`**

Crea (o edita) el archivo `.env` en la raíz del proyecto con tus credenciales

**5. Levantar el servidor de desarrollo**
```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) — redirige automáticamente a `/matriz`.

---

## 4. Notas operativas


- **Bitácora de ejecuciones**: cada vez que se procesa un Excel o se corre una priorización masiva, queda un registro inmutable en `mspo_ejecuciones_priorizacion` / `mspo_resultados_fichas` / `mspo_detalle_calculo_ficha` — estas tablas crecen indefinidamente por diseño (auditoría)
