-- Web Wizards Sales OS · D1 · documentos, revisión, investigación, sesiones, integraciones

-- Documentos (en producción no hay sistema de archivos): dossiers, evidencia estructurada y borradores.
-- Cada cambio crea una versión nueva (historial inmutable).
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,                       -- ruta equivalente en el repositorio, p. ej. data/outreach/WW-...-inicial.md
  kind TEXT NOT NULL CHECK (kind IN ('dossier','evidencia','borrador','reporte','captura')),
  lead_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  creado_por TEXT NOT NULL,
  UNIQUE (path, version)
);
CREATE INDEX IF NOT EXISTS ix_docs_lead ON documents(lead_id, kind);
CREATE TRIGGER IF NOT EXISTS trg_docs_no_update BEFORE UPDATE ON documents
BEGIN SELECT RAISE(ABORT, 'documents es versionado: se inserta una versión nueva'); END;
CREATE TRIGGER IF NOT EXISTS trg_docs_no_delete BEFORE DELETE ON documents
BEGIN SELECT RAISE(ABORT, 'documents es versionado: no se borra'); END;

-- Fuentes oficiales y referencias externas de cada lead (p. ej. id del DENUE)
CREATE TABLE IF NOT EXISTS lead_sources (
  lead_id TEXT NOT NULL,
  fuente TEXT NOT NULL,                     -- denue | osm | doctoralia | ...
  ref_id TEXT NOT NULL,                     -- Id / CLEE del DENUE, id de OSM, etc.
  url TEXT NOT NULL DEFAULT '',
  consultado_en TEXT NOT NULL,
  PRIMARY KEY (fuente, ref_id)
);

-- Área de revisión: candidatos investigados antes de registrarse
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,                      -- p. ej. data/staging/2026-11-11/slug.json o cand-<uuid>
  lote TEXT NOT NULL,
  request_id INTEGER,                       -- solicitud de prospección que lo originó (si aplica)
  data TEXT NOT NULL,                       -- JSON del candidato (esquema leadCandidate)
  dossier TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('revision','registrado','rechazado')),
  lead_id TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL DEFAULT '',
  fuente_ref TEXT NOT NULL DEFAULT '',      -- p. ej. denue:<Id>
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cand_estado ON candidates(estado, creado_en);
CREATE TRIGGER IF NOT EXISTS trg_cand_no_delete BEFORE DELETE ON candidates
BEGIN SELECT RAISE(ABORT, 'los candidatos se rechazan, no se borran'); END;
CREATE TRIGGER IF NOT EXISTS trg_cand_final BEFORE UPDATE ON candidates
WHEN OLD.estado IN ('registrado','rechazado')
BEGIN SELECT RAISE(ABORT, 'candidato ya resuelto'); END;

-- Solicitudes de prospección (motor)
CREATE TABLE IF NOT EXISTS research_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nicho TEXT NOT NULL CHECK (nicho IN ('clinica','dentista','estetica_spa','veterinaria')),
  estado_mx TEXT NOT NULL,
  municipio TEXT NOT NULL DEFAULT '',
  cantidad INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 200),
  criterios TEXT NOT NULL DEFAULT '{}',
  fuentes TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','buscando','investigando','completada','sin_fuente','error')),
  encontrados INTEGER NOT NULL DEFAULT 0,
  duplicados INTEGER NOT NULL DEFAULT 0,
  investigados INTEGER NOT NULL DEFAULT 0,
  descartados INTEGER NOT NULL DEFAULT 0,
  calificados INTEGER NOT NULL DEFAULT 0,
  en_revision INTEGER NOT NULL DEFAULT 0,
  mensaje TEXT NOT NULL DEFAULT '',
  creado_por TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- Trabajos para el investigador local (Mac). Un negocio por trabajo.
CREATE TABLE IF NOT EXISTS research_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES research_requests(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('site_audit','sin_sitio','descubrir_osm')),
  target TEXT NOT NULL,                     -- URL a auditar o referencia del negocio
  business TEXT NOT NULL,                   -- JSON con identidad y fuente (DENUE/OSM)
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','en_proceso','hecho','fallido','descartado')),
  intentos INTEGER NOT NULL DEFAULT 0,
  tomado_por TEXT NOT NULL DEFAULT '',
  tomado_en TEXT NOT NULL DEFAULT '',
  resultado TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  UNIQUE (request_id, target)
);
CREATE INDEX IF NOT EXISTS ix_jobs_estado ON research_jobs(estado, id);

-- Caché de fuentes externas (DENUE, OSM): respuestas públicas, sin tokens en la clave
CREATE TABLE IF NOT EXISTS source_cache (
  fuente TEXT NOT NULL,
  clave TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  consultado_en TEXT NOT NULL,
  expira_en TEXT NOT NULL,
  PRIMARY KEY (fuente, clave)
);

-- Sesiones (cookie HttpOnly; aquí solo el hash del identificador)
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  usuario TEXT NOT NULL,
  nombre TEXT NOT NULL,
  csrf TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  expira_en TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  revocada INTEGER NOT NULL DEFAULT 0
);

-- Límite de frecuencia (ventana fija) para login y API
CREATE TABLE IF NOT EXISTS rate_limits (
  clave TEXT NOT NULL,
  ventana TEXT NOT NULL,
  conteo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (clave, ventana)
);

-- Tareas internas (p. ej. generadas por n8n). Nunca representan envíos a prospectos.
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('revisar_candidato','aprobar_borrador','seguimiento','investigacion','reporte','otro')),
  lead_id TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL CHECK (length(titulo) BETWEEN 3 AND 200),
  detalle TEXT NOT NULL DEFAULT '',
  origen TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','hecha','descartada')),
  creado_en TEXT NOT NULL,
  cerrado_en TEXT NOT NULL DEFAULT ''
);

-- Configuración operativa (no políticas)
CREATE TABLE IF NOT EXISTS settings (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  actualizado_por TEXT NOT NULL
);
