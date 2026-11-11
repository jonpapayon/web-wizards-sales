-- Web Wizards Sales OS · D1 (SQLite) · esquema del CRM
-- Columnas idénticas a data/crm/*.csv (fuente original) para que la migración sea reversible y verificable.
-- Las reglas críticas se aplican en la propia base (restricciones y triggers), además de en la API.

-- ------------------------------------------------------------------ catálogo de transiciones (de crm.schema.json › x-transiciones)
CREATE TABLE IF NOT EXISTS allowed_transitions (
  desde TEXT NOT NULL,
  hacia TEXT NOT NULL,
  PRIMARY KEY (desde, hacia)
);
INSERT OR IGNORE INTO allowed_transitions (desde, hacia) VALUES
  ('calificado','mensaje_borrador'),('calificado','descartado'),
  ('mensaje_borrador','pendiente_aprobacion'),('mensaje_borrador','descartado'),
  ('pendiente_aprobacion','aprobado'),('pendiente_aprobacion','mensaje_borrador'),('pendiente_aprobacion','descartado'),
  ('aprobado','contactado'),('aprobado','mensaje_borrador'),
  ('contactado','en_conversacion'),('contactado','pausado'),('contactado','perdido'),
  ('en_conversacion','reunion_agendada'),('en_conversacion','pausado'),('en_conversacion','perdido'),
  ('reunion_agendada','propuesta_enviada'),('reunion_agendada','en_conversacion'),('reunion_agendada','perdido'),
  ('propuesta_enviada','ganado'),('propuesta_enviada','perdido'),('propuesta_enviada','en_conversacion'),
  ('pausado','mensaje_borrador'),('pausado','en_conversacion'),('pausado','perdido');

-- ------------------------------------------------------------------ leads
CREATE TABLE IF NOT EXISTS leads (
  lead_id TEXT PRIMARY KEY CHECK (lead_id GLOB 'WW-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]'),
  fecha_registro TEXT NOT NULL,
  fuente TEXT NOT NULL CHECK (fuente IN ('google_maps','google_busqueda','sitio_web','doctoralia','seccion_amarilla','directorio_otro','instagram','facebook','meta_ad_library','referido','evento','manual','denue','osm')),
  fuente_url TEXT NOT NULL CHECK (fuente_url LIKE 'http%'),
  fecha_fuente TEXT NOT NULL,
  nombre_negocio TEXT NOT NULL CHECK (length(nombre_negocio) >= 2),
  nombre_normalizado TEXT NOT NULL,
  nicho TEXT NOT NULL CHECK (nicho IN ('clinica','dentista','estetica_spa','veterinaria','otro')),
  subnicho TEXT NOT NULL DEFAULT '',
  ciudad TEXT NOT NULL,
  estado_mx TEXT NOT NULL,
  zona_horaria TEXT NOT NULL CHECK (zona_horaria LIKE 'America/%'),
  direccion TEXT NOT NULL DEFAULT '',
  google_maps_url TEXT NOT NULL DEFAULT '',
  google_place_id TEXT NOT NULL DEFAULT '',
  sitio_web TEXT NOT NULL DEFAULT '',
  dominio TEXT NOT NULL DEFAULT '',
  telefono_publico TEXT NOT NULL DEFAULT '',
  telefono_e164 TEXT NOT NULL DEFAULT '' CHECK (telefono_e164 = '' OR telefono_e164 GLOB '+52[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  whatsapp_publico TEXT NOT NULL DEFAULT '' CHECK (whatsapp_publico = '' OR whatsapp_publico GLOB '+52[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  email_publico TEXT NOT NULL DEFAULT '',
  instagram_url TEXT NOT NULL DEFAULT '',
  facebook_url TEXT NOT NULL DEFAULT '',
  otras_fuentes TEXT NOT NULL DEFAULT '',
  decisor_nombre TEXT NOT NULL DEFAULT '',
  decisor_cargo TEXT NOT NULL DEFAULT '',
  decisor_fuente_url TEXT NOT NULL DEFAULT '',
  num_resenas TEXT NOT NULL DEFAULT '',
  calificacion_google TEXT NOT NULL DEFAULT '',
  senales_oportunidad TEXT NOT NULL DEFAULT '',
  evidencias TEXT NOT NULL,
  servicio_recomendado TEXT NOT NULL,
  puntaje_icp INTEGER NOT NULL CHECK (puntaje_icp BETWEEN 0 AND 25),
  puntaje_oportunidad INTEGER NOT NULL CHECK (puntaje_oportunidad BETWEEN 0 AND 40),
  puntaje_contacto INTEGER NOT NULL CHECK (puntaje_contacto BETWEEN 0 AND 20),
  puntaje_capacidad INTEGER NOT NULL CHECK (puntaje_capacidad BETWEEN 0 AND 15),
  puntaje_total INTEGER NOT NULL CHECK (puntaje_total = puntaje_icp + puntaje_oportunidad + puntaje_contacto + puntaje_capacidad),
  clasificacion TEXT NOT NULL CHECK (clasificacion IN ('A','B','C','descartado')),
  motivo_clasificacion TEXT NOT NULL,
  estado_pipeline TEXT NOT NULL CHECK (estado_pipeline IN ('calificado','descartado','mensaje_borrador','pendiente_aprobacion','aprobado','contactado','en_conversacion','reunion_agendada','propuesta_enviada','ganado','perdido','pausado','no_contactar')),
  canal_preferido TEXT NOT NULL DEFAULT '',
  mensaje_inicial_id TEXT NOT NULL DEFAULT '',
  aprobacion_estado TEXT NOT NULL CHECK (aprobacion_estado IN ('no_aplica','pendiente','aprobado','rechazado','cambios_solicitados')),
  aprobado_por TEXT NOT NULL DEFAULT '',
  fecha_aprobacion TEXT NOT NULL DEFAULT '',
  fecha_primer_contacto TEXT NOT NULL DEFAULT '',
  fecha_ultima_interaccion TEXT NOT NULL DEFAULT '',
  proximo_seguimiento TEXT NOT NULL DEFAULT '',
  num_seguimientos INTEGER NOT NULL DEFAULT 0 CHECK (num_seguimientos BETWEEN 0 AND 3),
  consentimiento_whatsapp TEXT NOT NULL CHECK (consentimiento_whatsapp IN ('no','si_inicio_lead','si_explicito')),
  fecha_consentimiento TEXT NOT NULL DEFAULT '',
  opt_out TEXT NOT NULL CHECK (opt_out IN ('true','false')),
  fecha_opt_out TEXT NOT NULL DEFAULT '',
  responsable TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  fecha_actualizacion TEXT NOT NULL,
  -- reglas transversales
  CHECK (aprobacion_estado <> 'aprobado' OR (aprobado_por <> '' AND fecha_aprobacion <> '')),
  CHECK (lower(aprobado_por) NOT IN ('claude','agente','agent','lead-researcher','lead-qualifier','outreach-writer','crm-manager','follow-up-manager','compliance-reviewer','n8n','sistema','bot','ia','ai','cli','crm_tool','dashboard','api','worker','investigador')),
  CHECK (opt_out = 'false' OR (estado_pipeline = 'no_contactar' AND fecha_opt_out <> '')),
  CHECK (estado_pipeline NOT IN ('contactado','en_conversacion','reunion_agendada','propuesta_enviada','pausado') OR proximo_seguimiento <> '')
);
-- deduplicación: claves fuertes únicas (vacío = no aplica)
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_tel ON leads(telefono_e164) WHERE telefono_e164 <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_email ON leads(lower(email_publico)) WHERE email_publico <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_dominio ON leads(dominio) WHERE dominio <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_place ON leads(google_place_id) WHERE google_place_id <> '';
CREATE INDEX IF NOT EXISTS ix_leads_estado ON leads(estado_pipeline);
CREATE INDEX IF NOT EXISTS ix_leads_nombre_ciudad ON leads(nombre_normalizado, ciudad);
CREATE INDEX IF NOT EXISTS ix_leads_seguimiento ON leads(proximo_seguimiento) WHERE proximo_seguimiento <> '';

-- ------------------------------------------------------------------ interacciones (historial inmutable)
CREATE TABLE IF NOT EXISTS interactions (
  interaccion_id TEXT PRIMARY KEY CHECK (interaccion_id GLOB 'INT-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  lead_id TEXT NOT NULL REFERENCES leads(lead_id),
  fecha_hora TEXT NOT NULL,
  canal TEXT NOT NULL CHECK (canal IN ('email','whatsapp','telefono','formulario_web','instagram_dm','facebook_messenger','linkedin','presencial','interno')),
  direccion TEXT NOT NULL CHECK (direccion IN ('saliente','entrante','interna')),
  tipo TEXT NOT NULL CHECK (tipo IN ('mensaje_inicial','seguimiento','respuesta_lead','respuesta_ww','llamada','reunion','nota','opt_out','rebote','aprobacion','cambio_estado')),
  resumen TEXT NOT NULL,
  contenido_ref TEXT NOT NULL DEFAULT '',
  plantilla_id TEXT NOT NULL DEFAULT '',
  enviado_por TEXT NOT NULL CHECK (enviado_por IN ('humano','n8n','agente','lead')),
  aprobacion_ref TEXT NOT NULL DEFAULT '',
  resultado TEXT NOT NULL DEFAULT '' CHECK (resultado IN ('','enviado','entregado','leido','respondido','sin_respuesta','rebotado','fallido','n/a')),
  sentimiento TEXT NOT NULL DEFAULT '' CHECK (sentimiento IN ('','positivo','neutral','negativo','opt_out','n/a')),
  siguiente_accion TEXT NOT NULL DEFAULT '',
  fecha_siguiente_accion TEXT NOT NULL DEFAULT '',
  registrado_por TEXT NOT NULL,
  CHECK (NOT (direccion = 'saliente' AND tipo = 'mensaje_inicial') OR aprobacion_ref <> '')
);
CREATE INDEX IF NOT EXISTS ix_int_lead ON interactions(lead_id, fecha_hora);
CREATE TRIGGER IF NOT EXISTS trg_int_no_update BEFORE UPDATE ON interactions
BEGIN SELECT RAISE(ABORT, 'interactions es historial inmutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_int_no_delete BEFORE DELETE ON interactions
BEGIN SELECT RAISE(ABORT, 'interactions es historial inmutable'); END;

-- ------------------------------------------------------------------ seguimientos
CREATE TABLE IF NOT EXISTS followups (
  seguimiento_id TEXT PRIMARY KEY CHECK (seguimiento_id GLOB 'FU-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  lead_id TEXT NOT NULL REFERENCES leads(lead_id),
  fecha_programada TEXT NOT NULL,
  ventana_horaria TEXT NOT NULL DEFAULT '',
  numero_seguimiento INTEGER NOT NULL CHECK (numero_seguimiento BETWEEN 1 AND 3),
  canal TEXT NOT NULL,
  plantilla_id TEXT NOT NULL DEFAULT '',
  borrador_ref TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('programado','borrador_listo','pendiente_aprobacion','aprobado','enviado','cancelado','vencido')),
  requiere_aprobacion TEXT NOT NULL CHECK (requiere_aprobacion IN ('true','false')),
  regla_aplicada TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL,
  completado_en TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_fu_fecha ON followups(fecha_programada, estado);
CREATE TRIGGER IF NOT EXISTS trg_fu_no_delete BEFORE DELETE ON followups
BEGIN SELECT RAISE(ABORT, 'los seguimientos se cancelan, no se borran'); END;
CREATE TRIGGER IF NOT EXISTS trg_fu_closed BEFORE UPDATE ON followups
WHEN OLD.estado IN ('enviado','cancelado')
BEGIN SELECT RAISE(ABORT, 'seguimiento cerrado: no se modifica'); END;

-- ------------------------------------------------------------------ lista de exclusión (solo anexado)
CREATE TABLE IF NOT EXISTS suppression (
  valor TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('telefono_e164','email','dominio','google_place_id','nombre_ciudad')),
  lead_id TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL CHECK (motivo IN ('opt_out','cliente_actual','competidor','socio','solicitud_legal','rebote_permanente','repep')),
  fecha TEXT NOT NULL,
  fuente TEXT NOT NULL,
  notas TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tipo, valor)
);
CREATE TRIGGER IF NOT EXISTS trg_supp_no_update BEFORE UPDATE ON suppression
BEGIN SELECT RAISE(ABORT, 'suppression es solo de anexado'); END;
CREATE TRIGGER IF NOT EXISTS trg_supp_no_delete BEFORE DELETE ON suppression
BEGIN SELECT RAISE(ABORT, 'suppression es solo de anexado'); END;

-- ------------------------------------------------------------------ reglas de leads en la base
CREATE TRIGGER IF NOT EXISTS trg_leads_no_delete BEFORE DELETE ON leads
BEGIN SELECT RAISE(ABORT, 'los leads se cierran con estados, no se borran'); END;

-- un lead dado de baja no vuelve a cambiar (bajas irreversibles)
CREATE TRIGGER IF NOT EXISTS trg_leads_baja_irreversible BEFORE UPDATE ON leads
WHEN OLD.opt_out = 'true' OR OLD.estado_pipeline = 'no_contactar'
BEGIN SELECT RAISE(ABORT, 'lead dado de baja / no_contactar: no se modifica ni se reactiva'); END;

-- identidad inmutable
CREATE TRIGGER IF NOT EXISTS trg_leads_identidad BEFORE UPDATE ON leads
WHEN NEW.lead_id <> OLD.lead_id OR NEW.fecha_registro <> OLD.fecha_registro OR NEW.fuente <> OLD.fuente OR NEW.fuente_url <> OLD.fuente_url
BEGIN SELECT RAISE(ABORT, 'lead_id, fecha_registro y fuente son inmutables'); END;

-- solo transiciones válidas (no_contactar solo como baja/supresión)
CREATE TRIGGER IF NOT EXISTS trg_leads_transicion BEFORE UPDATE OF estado_pipeline ON leads
WHEN NEW.estado_pipeline <> OLD.estado_pipeline
 AND NOT (NEW.estado_pipeline = 'no_contactar' AND OLD.estado_pipeline NOT IN ('ganado'))
 AND NOT EXISTS (SELECT 1 FROM allowed_transitions WHERE desde = OLD.estado_pipeline AND hacia = NEW.estado_pipeline)
BEGIN SELECT RAISE(ABORT, 'transición de estado no permitida'); END;

-- no se puede registrar un negocio que está en la lista de exclusión
CREATE TRIGGER IF NOT EXISTS trg_leads_suprimido BEFORE INSERT ON leads
WHEN EXISTS (SELECT 1 FROM suppression s WHERE
     (s.tipo = 'telefono_e164' AND s.valor IN (NEW.telefono_e164, NEW.whatsapp_publico) AND s.valor <> '')
  OR (s.tipo = 'email' AND s.valor = lower(NEW.email_publico) AND s.valor <> '')
  OR (s.tipo = 'dominio' AND s.valor = NEW.dominio AND s.valor <> '')
  OR (s.tipo = 'google_place_id' AND s.valor = NEW.google_place_id AND s.valor <> '')
  OR (s.tipo = 'nombre_ciudad' AND s.valor = NEW.nombre_normalizado || '|' || lower(NEW.ciudad)))
BEGIN SELECT RAISE(ABORT, 'el negocio está en la lista de exclusión'); END;

-- ------------------------------------------------------------------ auditoría y eventos (solo anexado)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  evento TEXT NOT NULL,
  actor TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entorno TEXT NOT NULL DEFAULT 'real',
  detalle TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS ix_audit_entidad ON audit_log(entidad);
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es solo de anexado'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es solo de anexado'); END;
