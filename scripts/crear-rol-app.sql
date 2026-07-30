-- =====================================================================
-- Crea el rol de aplicación `mspo_admin` con control total sobre la base
-- `mspo` en Azure Database for PostgreSQL – Flexible Server.
--
-- CÓMO EJECUTARLO
--   Conectado COMO EL ADMINISTRADOR DEL SERVIDOR (el "Administrator login"
--   que aparece en la pestaña Overview del servidor en el portal de Azure),
--   contra la base `mspo`:
--
--     psql "host=<servidor>.postgres.database.azure.com port=5432 \
--           dbname=mspo user=<admin> sslmode=require" -f crear-rol-app.sql
--
--   Si no tienes psql instalado, la vía sin instalar nada es Azure Cloud
--   Shell (icono de consola en el portal): ya trae psql.
--
-- ANTES DE EJECUTAR: cambia la contraseña de la línea marcada más abajo.
--
-- POR QUÉ UN ROL APARTE Y NO EL ADMIN DEL SERVIDOR
--   El admin del servidor gobierna *todas* las bases de la instancia. Un rol
--   por aplicación limita el daño de una credencial filtrada y permite
--   rotarla sin afectar nada más. Y como la aplicación se va a desplegar sin
--   autenticación y con el firewall abierto a internet, acotar ese alcance
--   deja de ser un detalle de estilo.
--
-- QUÉ HACE
--   Convierte a `mspo_admin` en DUEÑO de la base. Así, todo lo que cree
--   después `mpo.sql` (10 tablas, 14 índices, 1 vista) le pertenece
--   automáticamente y no hacen falta GRANT posteriores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Crear el rol si no existe.
-- ---------------------------------------------------------------------
-- ⚠ CAMBIA 'CAMBIA_ESTA_CONTRASENA' por una contraseña fuerte.
--   Azure exige 8-128 caracteres con mayúsculas, minúsculas, números y
--   símbolos. Evita `@`, `:`, `/` y `%` para no tener que escaparla en
--   cadenas de conexión.
--   PostgreSQL 14+ la almacena sólo con SCRAM-SHA-256.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mspo_admin') THEN
        CREATE ROLE mspo_admin WITH LOGIN PASSWORD 'CAMBIA_ESTA_CONTRASENA';
        RAISE NOTICE 'Rol mspo_admin creado.';
    ELSE
        RAISE NOTICE 'El rol mspo_admin ya existía; no se toca su contraseña.';
    END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 2. Hacer al admin del servidor miembro del nuevo rol.
-- ---------------------------------------------------------------------
-- PostgreSQL exige ser miembro (directo o indirecto) de un rol para poder
-- transferirle la propiedad de una base. `current_user` evita tener que
-- escribir aquí el nombre del admin de Azure, que varía por servidor.
DO $$
BEGIN
    EXECUTE format('GRANT mspo_admin TO %I', current_user);
END
$$;

-- ---------------------------------------------------------------------
-- 3. Propiedad y privilegios sobre la base.
-- ---------------------------------------------------------------------
ALTER DATABASE mspo OWNER TO mspo_admin;
GRANT ALL PRIVILEGES ON DATABASE mspo TO mspo_admin;

-- ---------------------------------------------------------------------
-- 4. Esquema `public`.
-- ---------------------------------------------------------------------
-- Desde PostgreSQL 15 el esquema `public` pertenece a `pg_database_owner` y
-- ya no concede CREATE a PUBLIC. Al ser dueño de la base, `mspo_admin` hereda
-- el control, pero se concede explícitamente para que funcione igual en 13/14.
GRANT ALL ON SCHEMA public TO mspo_admin;

-- Traspasar la propiedad del esquema es lo más limpio, pero en Azure puede
-- estar restringido según el rol del administrador. Si falla, no es grave:
-- el paso anterior ya deja privilegios suficientes.
DO $$
BEGIN
    EXECUTE 'ALTER SCHEMA public OWNER TO mspo_admin';
    RAISE NOTICE 'Esquema public traspasado a mspo_admin.';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo traspasar el esquema public (%). Se continúa: los privilegios del paso 4 bastan.', SQLERRM;
END
$$;

-- ---------------------------------------------------------------------
-- 5. Privilegios por defecto para objetos futuros.
-- ---------------------------------------------------------------------
-- Cubre el caso de que alguna tabla acabe creada por el admin del servidor en
-- vez de por mspo_admin (p. ej. si se aplica mpo.sql con la credencial de
-- admin antes de cambiar el .env).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO mspo_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO mspo_admin;

-- ---------------------------------------------------------------------
-- 6. Verificación.
-- ---------------------------------------------------------------------
SELECT
    r.rolname                                        AS rol,
    r.rolcanlogin                                    AS puede_iniciar_sesion,
    pg_catalog.pg_get_userbyid(d.datdba)             AS dueno_de_la_base
FROM pg_roles r
CROSS JOIN pg_database d
WHERE r.rolname = 'mspo_admin'
  AND d.datname = 'mspo';
