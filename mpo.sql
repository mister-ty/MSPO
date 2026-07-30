-------------------------------------------------------------
-- BLOQUE 1 — Datos operativos SIRO (fichas y resultados de priorización activa)
-- -----------------------------------------------------------------------------

-- Tabla maestra de fichas SIRO. Las columnas reflejan exactamente las cabeceras
-- del Excel exportado del SIRO transaccional. El motor de priorización lee de
-- aquí cuando se invoca el flujo masivo por códigos (vs. el flujo Excel que
-- procesa filas en memoria sin tocar esta tabla).
CREATE TABLE IF NOT EXISTS siro_fichas_base (
    "CODIGO FICHA"                       TEXT PRIMARY KEY,
    "GRUPO SOLICITUD"                    TEXT,
    "TIPO SOLICITUD"                     TEXT,
    "FECHA REGISTRO FICHA"               TEXT,
    "FECHA"                              TEXT,
    "TIPO MATRIZ"                        TEXT,
    "CALIFICACION MATRIZ"                TEXT,
    "AMENAZA AVENIDAS TORRENCIALES"      TEXT,
    "AMENAZA INUNDACIONES"               TEXT,
    "AMENAZA MOVIMIENTO EN MASA"         TEXT,
    "RETIROS DE QUEBRADA"                TEXT,
    "PROYECTOS VIALES"                   TEXT,
    "ESPACIO PUBLICO PROYECTADO"         TEXT,
    "CATEGORIA EQUIPAMIENTO"             TEXT,
    "CANTIDAD SOLICITUDES RELACIONADAS"  INTEGER,
    "ESTADO FICHA"                       TEXT NOT NULL DEFAULT 'Sin ejecutar',
    "FICHA RESERVADA"                    INTEGER NOT NULL DEFAULT 0,  -- 0/1
    "¿TIENE UBICACIÓN?"                  TEXT DEFAULT 'NO'
);

CREATE INDEX IF NOT EXISTS idx_siro_fichas_estado     ON siro_fichas_base ("ESTADO FICHA");
CREATE INDEX IF NOT EXISTS idx_siro_fichas_reservada  ON siro_fichas_base ("FICHA RESERVADA");
CREATE INDEX IF NOT EXISTS idx_siro_fichas_grupo      ON siro_fichas_base ("GRUPO SOLICITUD");
CREATE INDEX IF NOT EXISTS idx_siro_fichas_fecha      ON siro_fichas_base ("FECHA");


-- Vista técnica usada por diagnoseFicha(codigo_ficha) para explicar por qué
-- una ficha quedó fuera del set priorizable. Devuelve el mismo set que la
-- consulta canónica de priorización aplicada SIN filtros dinámicos.
-- CREATE OR REPLACE evita el DROP previo (y el aviso de "no existe, se
-- omite" que salía la primera vez que se corría el script).
CREATE OR REPLACE VIEW siro_vw_fichas_para_priorizar AS
SELECT *
FROM siro_fichas_base
WHERE "ESTADO FICHA" IN ('Sin ejecutar', 'Parcialmente ejecutada')
  AND "FICHA RESERVADA" = 0;


-- Resultados activos de priorización por ficha (un único registro vigente por
-- código). Se mantiene como tabla "viva" para que dashboards externos puedan
-- consultar el puntaje actual sin recorrer la bitácora completa.
-- El método saveResults() hace UPSERT por codigo_ficha (ON CONFLICT).
CREATE TABLE IF NOT EXISTS siro_priorizacion_resultados (
    id_resultado            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_ficha            TEXT NOT NULL UNIQUE,
    puntaje_final           TEXT,
    responsable_ejecucion   TEXT,
    es_activo               INTEGER NOT NULL DEFAULT 1,  -- 0/1
    actualizado_en          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (codigo_ficha)
        REFERENCES siro_fichas_base ("CODIGO FICHA")
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_siro_resultados_activo
    ON siro_priorizacion_resultados (es_activo);


-- Trazabilidad asociada a cada resultado activo: un row por (resultado, grupo).
-- saveResults() borra y reinserta todos los rows de un id_resultado cada vez
-- que el puntaje se recalcula.
CREATE TABLE IF NOT EXISTS siro_priorizacion_trazabilidad (
    id_trazabilidad   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_resultado      INTEGER NOT NULL,
    nombre_campo      TEXT NOT NULL,
    valor_calculado   TEXT,
    FOREIGN KEY (id_resultado)
        REFERENCES siro_priorizacion_resultados (id_resultado)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_siro_trazabilidad_resultado
    ON siro_priorizacion_trazabilidad (id_resultado);


-- -----------------------------------------------------------------------------
-- BLOQUE 2 — Configuración de la Matriz Institucional (MSPO)
-- -----------------------------------------------------------------------------
-- Define los grupos, variables y valores que el motor de cálculo aplica.
-- Solo UNA matriz puede tener esta_activa = 1 al mismo tiempo.

CREATE TABLE IF NOT EXISTS mspo_matrices (
    id_matriz       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_matriz   TEXT NOT NULL,
    esta_activa     INTEGER NOT NULL DEFAULT 0,  -- 0/1 — solo una en 1
    descripcion     TEXT,
    creada_en       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Garantiza que como máximo exista una matriz activa.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mspo_matrices_una_activa
    ON mspo_matrices (esta_activa) WHERE esta_activa = 1;


-- Grupos de criterios dentro de una matriz (ej. "Calificación de la
-- infraestructura", "Cercanía con equipamientos", "Antigüedad", etc.).
-- peso_grupo se interpreta como porcentaje (0–100); la suma de pesos de
-- todos los grupos de una matriz debería sumar 100.
CREATE TABLE IF NOT EXISTS mspo_grupos_priorizacion (
    id_grupo      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_matriz     INTEGER NOT NULL,
    nombre_grupo  TEXT NOT NULL,
    peso_grupo    TEXT NOT NULL,  -- almacenado como TEXT para preservar precisión
    orden         INTEGER DEFAULT 0,
    FOREIGN KEY (id_matriz)
        REFERENCES mspo_matrices (id_matriz)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mspo_grupos_matriz
    ON mspo_grupos_priorizacion (id_matriz);


-- Variables que componen cada grupo (mapean a columnas SIRO vía COLUMN_MAPPING
-- en lib/services/prioritization.js de la aplicación).
CREATE TABLE IF NOT EXISTS mspo_variables_priorizacion (
    id_variable      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_grupo         INTEGER NOT NULL,
    nombre_variable  TEXT NOT NULL,
    peso_variable    TEXT NOT NULL,  -- 0–100
    FOREIGN KEY (id_grupo)
        REFERENCES mspo_grupos_priorizacion (id_grupo)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mspo_variables_grupo
    ON mspo_variables_priorizacion (id_grupo);


-- Catálogo de valores de entrada por variable y su puntaje asignado.
-- Ejemplo: variable "AMENAZA INUNDACIONES" → valores {"Alta": 100, "Media": 50,
-- "Baja": 30, "Sin Información": 0}. El motor matchea valor_entrada exacta
-- (case-sensitive) excepto para "CATEGORIA EQUIPAMIENTO" donde usa includes().
CREATE TABLE IF NOT EXISTS mspo_valores_variables (
    id_valor          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_variable       INTEGER NOT NULL,
    valor_entrada     TEXT NOT NULL,
    puntaje_asignado  TEXT NOT NULL,  -- 0–100
    FOREIGN KEY (id_variable)
        REFERENCES mspo_variables_priorizacion (id_variable)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mspo_valores_variable
    ON mspo_valores_variables (id_variable);


-- -----------------------------------------------------------------------------
-- BLOQUE 3 — Bitácora de ejecuciones (auditoría inmutable)
-- -----------------------------------------------------------------------------
-- Cada corrida de priorización masiva genera una ejecucion + N resultados
-- + N*M detalles. NO se borran nunca; las correcciones se hacen creando una
-- nueva ejecución.

CREATE TABLE IF NOT EXISTS mspo_ejecuciones_priorizacion (
    id_ejecucion             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    responsable_ejecucion    TEXT NOT NULL,
    tipo_ejecucion           TEXT NOT NULL,  -- ej. "Masiva_Calibrada_2026"
    id_matriz_usada          INTEGER NOT NULL,
    ejecutada_en             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_matriz_usada)
        REFERENCES mspo_matrices (id_matriz)
);

CREATE INDEX IF NOT EXISTS idx_mspo_ejecuciones_matriz
    ON mspo_ejecuciones_priorizacion (id_matriz_usada);


-- Resultado por ficha dentro de una ejecución. inputs_completos guarda el
-- snapshot exacto de la fila SIRO usada para el cálculo (formato JSON), de
-- modo que el cálculo es reproducible aunque la ficha cambie después.
CREATE TABLE IF NOT EXISTS mspo_resultados_fichas (
    id_resultado_ficha         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_ejecucion               INTEGER NOT NULL,
    codigo_ficha               TEXT NOT NULL,
    puntaje_final_calculado    TEXT,
    inputs_completos           TEXT,  -- JSON serializado
    FOREIGN KEY (id_ejecucion)
        REFERENCES mspo_ejecuciones_priorizacion (id_ejecucion)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mspo_resultados_ejecucion
    ON mspo_resultados_fichas (id_ejecucion);
CREATE INDEX IF NOT EXISTS idx_mspo_resultados_codigo
    ON mspo_resultados_fichas (codigo_ficha);


-- Trazabilidad granular: una fila por (resultado, grupo) y por (resultado,
-- variable). Permite reconstruir el puntaje completo desde el log auditable.
CREATE TABLE IF NOT EXISTS mspo_detalle_calculo_ficha (
    id_detalle                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_resultado_ficha          INTEGER NOT NULL,
    nombre_grupo                TEXT NOT NULL,
    nombre_variable             TEXT,
    valor_usado                 TEXT,
    puntaje_obtenido_variable   TEXT,
    puntaje_ponderado_grupo     TEXT,
    FOREIGN KEY (id_resultado_ficha)
        REFERENCES mspo_resultados_fichas (id_resultado_ficha)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mspo_detalle_resultado
    ON mspo_detalle_calculo_ficha (id_resultado_ficha);


-- -----------------------------------------------------------------------------
-- BLOQUE 4 — Configuración inicial: matriz activa (grupos, variables, valores)
-- -----------------------------------------------------------------------------
-- Sin esto la aplicación no puede calcular nada: /api/mspo/matrix/active
-- devuelve "No hay matriz activa configurada" si mspo_matrices está vacía.
--
-- IMPORTANTE — estos son valores de EJEMPLO (pesos de grupo: Calificación 30%,
-- Cercanía 15%, Amenazas 25%, Afectación 15%, Demanda 10%, Antigüedad 5% =
-- 100%). Edítalos con los pesos y valores reales de tu matriz institucional
-- antes de usar la app en serio — solo cambia los números/textos de los
-- INSERT de abajo, la estructura no necesita tocarse.
--
-- Este bloque asume que las tablas mspo_* están vacías (primera carga). Si
-- corres el script completo dos veces vas a chocar con la restricción de
-- "una sola matriz activa" (ux_mspo_matrices_una_activa) — es intencional,
-- para no dejar dos matrices activas por accidente.

INSERT INTO mspo_matrices (nombre_matriz, esta_activa, descripcion)
VALUES ('Matriz Institucional 2026', 1, 'Configuración activa');

-- id_matriz = 1 (primera fila insertada)

INSERT INTO mspo_grupos_priorizacion (id_matriz, nombre_grupo, peso_grupo, orden) VALUES
(1, 'Calificación de la infraestructura', '30', 1),
(1, 'Cercanía con equipamientos', '15', 2),
(1, 'Amenazas y riesgos', '25', 3),
(1, 'Afectación urbanística', '15', 4),
(1, 'Demanda ciudadana', '10', 5),
(1, 'Antigüedad', '5', 6);

-- Grupo 1 "Calificación de la infraestructura" no usa variables (toma
-- CALIFICACION MATRIZ directo, ver lib/services/prioritization.js).

-- Grupo 2: Cercanía con equipamientos
INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable) VALUES
(2, 'CATEGORIA EQUIPAMIENTO', '100');

INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
(1, 'Salud', '100'),
(1, 'Educación', '80'),
(1, 'Recreación', '60'),
(1, 'Sin Información', '0');

-- Grupo 3: Amenazas y riesgos
INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable) VALUES
(3, 'AMENAZA AVENIDAS TORRENCIALES', '34'),
(3, 'AMENAZA INUNDACIONES', '33'),
(3, 'AMENAZA MOVIMIENTO EN MASA', '33');

INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado)
SELECT id_variable, v.valor_entrada, v.puntaje_asignado
FROM mspo_variables_priorizacion,
     (SELECT 'Alta' AS valor_entrada, '100' AS puntaje_asignado
      UNION ALL SELECT 'Media', '50'
      UNION ALL SELECT 'Baja', '30'
      UNION ALL SELECT 'Sin Información', '0') v
WHERE nombre_variable IN ('AMENAZA AVENIDAS TORRENCIALES', 'AMENAZA INUNDACIONES', 'AMENAZA MOVIMIENTO EN MASA');

-- Grupo 4: Afectación urbanística
INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable) VALUES
(4, 'RETIROS DE QUEBRADA', '34'),
(4, 'PROYECTOS VIALES', '33'),
(4, 'ESPACIO PUBLICO PROYECTADO', '33');

INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado)
SELECT id_variable, v.valor_entrada, v.puntaje_asignado
FROM mspo_variables_priorizacion,
     (SELECT 'SI' AS valor_entrada, '100' AS puntaje_asignado
      UNION ALL SELECT 'NO', '30'
      UNION ALL SELECT 'Sin Información', '0') v
WHERE nombre_variable IN ('RETIROS DE QUEBRADA', 'PROYECTOS VIALES', 'ESPACIO PUBLICO PROYECTADO');

-- Grupo 5: Demanda ciudadana (regla especial por umbrales, no requiere valores)
INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable) VALUES
(5, 'CANTIDAD SOLICITUDES RELACIONADAS', '100');

-- Grupo 6: Antigüedad (regla especial por años transcurridos, no requiere valores)
INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable) VALUES
(6, 'FECHA', '100');
