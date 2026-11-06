-- =====================================================================
-- Matriz de priorización de la Unidad de Mantenimiento.
--
-- FUENTES
--   - 20260211 Matriz de priorización Mtto - Formulado 1.xlsx
--   - 20260407 Diccionario_matriz_priorizacion (V1).pdf
--   Donde el Excel no define un valor que SIRO sí exporta (p. ej. Media en
--   avenidas torrenciales) manda el diccionario.
--
-- VALIDACIÓN
--   CP.17995 del reporte SIRO del 2026-11-06 debe dar 75.59 (columna M del
--   Excel): 18.19 + 20 + 30 + 7.4.
--
-- CÓMO EJECUTARLO
--   node scripts/ejecutar-sql.js scripts/matriz-mantenimiento-2026.sql
--   La app lee la matriz activa en cada petición: no requiere redespliegue.
--
-- Es re-ejecutable: si la matriz ya existe no modifica nada. La matriz activa
-- anterior se desactiva pero no se borra, porque la bitácora de ejecuciones la
-- referencia por id_matriz_usada.
--
-- REVERSIÓN (el orden importa: solo puede haber una matriz activa)
--   UPDATE mspo_matrices SET esta_activa = 0 WHERE nombre_matriz = 'Matriz Mantenimiento 2026';
--   UPDATE mspo_matrices SET esta_activa = 1 WHERE nombre_matriz = '<matriz anterior>';
--
-- CONTRATO CON EL MOTOR (priorizacion/lib/engine-browser.js y
-- lib/services/prioritization.js)
--   - 'Calificación de la infraestructura' y 'Cercanía con equipamientos' se
--     identifican por nombre exacto: renombrarlos rompe el cálculo.
--   - nombre_variable debe coincidir con COLUMN_MAPPING; si no, se ignora.
--   - Normativa compara valor_entrada de forma exacta y un valor que no esté en
--     el catálogo puntúa 0. De eso dependen los códigos de proyecto
--     ('01-1982-001', 'Eje Proyecto', 'Tiene varios'...), que SIRO exporta en
--     lugar de 'SI' y equivalen a SI / Proyectado = 0.
--   - Cercanía compara con includes() y toma el mayor puntaje encontrado.
--   - Cantidad y antigüedad usan umbrales fijos en el motor: sus valores aquí
--     son solo documentales.
-- =====================================================================

DO $$
DECLARE
    v_matriz   INTEGER;
    v_grupo    INTEGER;
    v_variable INTEGER;
    v_amenaza  RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM mspo_matrices WHERE nombre_matriz = 'Matriz Mantenimiento 2026') THEN
        RAISE NOTICE 'La Matriz Mantenimiento 2026 ya existe; no se modifica nada.';
        RETURN;
    END IF;

    UPDATE mspo_matrices SET esta_activa = 0 WHERE esta_activa = 1;

    INSERT INTO mspo_matrices (nombre_matriz, esta_activa, descripcion)
    VALUES ('Matriz Mantenimiento 2026', 1, 'Matriz de priorización Mtto - Formulado 1 (20260211) y Diccionario V1 (20260407)')
    RETURNING id_matriz INTO v_matriz;

    -- -----------------------------------------------------------------
    -- Calificación de la infraestructura (30%): valor directo de
    -- CALIFICACION MATRIZ; el motor no usa variables en este grupo.
    -- -----------------------------------------------------------------
    INSERT INTO mspo_grupos_priorizacion (id_matriz, nombre_grupo, peso_grupo, orden)
    VALUES (v_matriz, 'Calificación de la infraestructura', '30', 1);

    -- -----------------------------------------------------------------
    -- Normativa (20%)
    -- -----------------------------------------------------------------
    INSERT INTO mspo_grupos_priorizacion (id_matriz, nombre_grupo, peso_grupo, orden)
    VALUES (v_matriz, 'Normativa', '20', 2)
    RETURNING id_grupo INTO v_grupo;

    -- Amenazas. SIRO exporta celdas combinadas ('Alta, Baja, Media') y el motor
    -- compara de forma exacta, así que el catálogo incluye cada nivel y sus
    -- combinaciones de 2 y 3 niveles en cualquier orden. Regla del diccionario:
    -- con alguna Alta vale lo de Alta, con Media (sin Alta) 50, y el resto 100.
    FOR v_amenaza IN
        SELECT * FROM (VALUES
            (1, 'AMENAZA AVENIDAS TORRENCIALES', '15', 0),
            (2, 'AMENAZA INUNDACIONES',          '15', 25),
            (3, 'AMENAZA MOVIMIENTO EN MASA',    '20', 25)
        ) AS t (orden, nombre, peso, puntaje_alta)
        ORDER BY orden
    LOOP
        INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
        VALUES (v_grupo, v_amenaza.nombre, v_amenaza.peso)
        RETURNING id_variable INTO v_variable;

        INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado)
        WITH niveles (nivel, puntaje) AS (
            VALUES ('Alta', v_amenaza.puntaje_alta),
                   ('Media', 50),
                   ('Baja', 100),
                   ('Muy Baja', 100),
                   ('Sin Información', 100)
        )
        SELECT v_variable, a.nivel, a.puntaje::text
        FROM niveles a
        UNION ALL
        SELECT v_variable, a.nivel || ', ' || b.nivel, LEAST(a.puntaje, b.puntaje)::text
        FROM niveles a
        JOIN niveles b ON b.nivel <> a.nivel
        UNION ALL
        SELECT v_variable, a.nivel || ', ' || b.nivel || ', ' || c.nivel, LEAST(a.puntaje, b.puntaje, c.puntaje)::text
        FROM niveles a
        JOIN niveles b ON b.nivel <> a.nivel
        JOIN niveles c ON c.nivel NOT IN (a.nivel, b.nivel);
    END LOOP;

    INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
    VALUES (v_grupo, 'RETIROS DE QUEBRADA', '20')
    RETURNING id_variable INTO v_variable;
    INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
        (v_variable, 'Áreas de interés estratégico - Sistema Hidrográfico', '0'),
        (v_variable, 'SI', '0'),
        (v_variable, 'NO', '100'),
        (v_variable, 'Sin Información', '100');

    INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
    VALUES (v_grupo, 'PROYECTOS VIALES', '15')
    RETURNING id_variable INTO v_variable;
    INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
        (v_variable, 'SI', '0'),
        (v_variable, 'Proyectado', '0'),
        (v_variable, 'NO', '100'),
        (v_variable, 'Sin Información', '100');

    -- 'No Posee' es como SIRO exporta el NO del diccionario en esta variable.
    INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
    VALUES (v_grupo, 'ESPACIO PUBLICO PROYECTADO', '15')
    RETURNING id_variable INTO v_variable;
    INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
        (v_variable, 'SI', '0'),
        (v_variable, 'Proyectado', '0'),
        (v_variable, 'NO', '100'),
        (v_variable, 'No Posee', '100'),
        (v_variable, 'Sin Información', '100');

    -- -----------------------------------------------------------------
    -- Cercanía con equipamientos (30%)
    -- 'desatres' es la grafía con la que SIRO exporta hoy esa categoría.
    -- -----------------------------------------------------------------
    INSERT INTO mspo_grupos_priorizacion (id_matriz, nombre_grupo, peso_grupo, orden)
    VALUES (v_matriz, 'Cercanía con equipamientos', '30', 3)
    RETURNING id_grupo INTO v_grupo;

    INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
    VALUES (v_grupo, 'CATEGORIA EQUIPAMIENTO', '100')
    RETURNING id_variable INTO v_variable;
    INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
        (v_variable, 'Equipamiento de Educación', '100'),
        (v_variable, 'Equipamiento de Salud', '100'),
        (v_variable, 'Equipamiento de Recreación y Deporte', '65'),
        (v_variable, 'Equipamiento de Asistencia Social', '65'),
        (v_variable, 'Equipamientos Comunitarios', '50'),
        (v_variable, 'Equipamientos Culturales', '50'),
        (v_variable, 'Equipamientos de Culto', '50'),
        (v_variable, 'Equipamientos para el Transporte', '35'),
        (v_variable, 'Equipamientos Institucionales Municipales', '30'),
        (v_variable, 'Equipamiento de Almacenamiento y distribución de combustibles', '15'),
        (v_variable, 'Equipamiento de Prevención y atención de desatres', '15'),
        (v_variable, 'Equipamiento de Prevención y atención de desastres', '15'),
        (v_variable, 'Equipamiento para la Administración de Justicia', '15'),
        (v_variable, 'Equipamientos de almacenamiento y distribución del sector primario y del comercio popular', '15'),
        (v_variable, 'Equipamientos Institucionales Locales', '15'),
        (v_variable, 'Equipamientos Institucionales Metropolitanos', '15'),
        (v_variable, 'Equipamientos Institucionales Nacionales', '15'),
        (v_variable, 'Equipamientos Institucionales Regionales', '15'),
        (v_variable, 'Equipamientos Sanitarios', '15'),
        (v_variable, 'Equipamientos para la prestación de los servicios públicos', '15'),
        (v_variable, 'Equipamientos para la Fuerza Pública', '15'),
        (v_variable, 'Equipamientos de Justicia Cercana al Ciudadano', '15'),
        (v_variable, 'Abastecimiento Alimentario', '15'),
        (v_variable, 'Seguridad y Convivencia', '15'),
        (v_variable, 'Sin Información', '0');

    -- -----------------------------------------------------------------
    -- Solicitudes (20%). En el Excel la celda del grupo dice "p" por error.
    -- -----------------------------------------------------------------
    INSERT INTO mspo_grupos_priorizacion (id_matriz, nombre_grupo, peso_grupo, orden)
    VALUES (v_matriz, 'Solicitudes', '20', 4)
    RETURNING id_grupo INTO v_grupo;

    INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
    VALUES (v_grupo, 'CANTIDAD SOLICITUDES RELACIONADAS', '35')
    RETURNING id_variable INTO v_variable;
    INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
        (v_variable, 'Mayor a 30', '100'),
        (v_variable, 'Entre 15 y 30', '50'),
        (v_variable, 'Entre 0 y 15', '30');

    INSERT INTO mspo_variables_priorizacion (id_grupo, nombre_variable, peso_variable)
    VALUES (v_grupo, 'FECHA', '65')
    RETURNING id_variable INTO v_variable;
    INSERT INTO mspo_valores_variables (id_variable, valor_entrada, puntaje_asignado) VALUES
        (v_variable, 'Mayor a 4 años', '100'),
        (v_variable, 'Entre 2 y 4 años', '50'),
        (v_variable, 'Entre 0 y 2 años', '30');
END
$$;

-- Verificación: los pesos de los grupos de la matriz activa deben sumar 100.
SELECT m.id_matriz, m.nombre_matriz, g.nombre_grupo, g.peso_grupo, COUNT(v.id_variable) AS variables
FROM mspo_matrices m
JOIN mspo_grupos_priorizacion g ON g.id_matriz = m.id_matriz
LEFT JOIN mspo_variables_priorizacion v ON v.id_grupo = g.id_grupo
WHERE m.esta_activa = 1
GROUP BY m.id_matriz, m.nombre_matriz, g.id_grupo, g.nombre_grupo, g.peso_grupo
ORDER BY g.id_grupo;
