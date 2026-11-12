-- Web Wizards Sales OS · D1 · rúbrica v2 y nichos ampliados (P1, 2026-11-12)
-- Nichos nuevos: belleza, fitness, inmobiliaria, autos, energia_solar, construccion, educacion, viajes, industrial, retail, distribucion.
-- Columna nueva en leads: criterios (JSON con los 8 criterios de x-rubrica-v2; vacío = lead calificado con la rúbrica v1).
-- Mismo método que 0003/0004 (renombrar → crear → copiar → borrar viejas → índices y triggers). Fuente: data/schema/crm.schema.json.

ALTER TABLE followups RENAME TO _old_followups;
ALTER TABLE interactions RENAME TO _old_interactions;
ALTER TABLE leads RENAME TO _old_leads;

-- ------------------------------------------------------------------ leads
CREATE TABLE leads (
  lead_id TEXT PRIMARY KEY CHECK (length(lead_id) = 15 AND substr(lead_id, 1, 3) = 'WW-' AND substr(lead_id, 12, 1) = '-'
    AND (substr(lead_id, 4, 8) || substr(lead_id, 13, 3)) NOT GLOB '*[^0-9]*'),
  fecha_registro TEXT NOT NULL,
  fuente TEXT NOT NULL CHECK (fuente IN ('google_maps','google_busqueda','sitio_web','doctoralia','seccion_amarilla','directorio_otro','instagram','facebook','meta_ad_library','referido','evento','manual','denue','osm')),
  fuente_url TEXT NOT NULL CHECK (fuente_url LIKE 'http%'),
  fecha_fuente TEXT NOT NULL,
  nombre_negocio TEXT NOT NULL CHECK (length(nombre_negocio) >= 2),
  nombre_normalizado TEXT NOT NULL,
  nicho TEXT NOT NULL CHECK (nicho IN ('clinica','dentista','estetica_spa','veterinaria','belleza','fitness','inmobiliaria','autos','energia_solar','construccion','educacion','viajes','industrial','retail','distribucion','otro')),
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
  telefono_e164 TEXT NOT NULL DEFAULT '' CHECK (telefono_e164 = '' OR (length(telefono_e164) = 13
    AND substr(telefono_e164, 1, 3) = '+52' AND substr(telefono_e164, 4) NOT GLOB '*[^0-9]*')),
  whatsapp_publico TEXT NOT NULL DEFAULT '' CHECK (whatsapp_publico = '' OR (length(whatsapp_publico) = 13
    AND substr(whatsapp_publico, 1, 3) = '+52' AND substr(whatsapp_publico, 4) NOT GLOB '*[^0-9]*')),
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
  estado_pipeline TEXT NOT NULL CHECK (estado_pipeline IN ('calificado','descartado','mensaje_borrador','pendiente_aprobacion','aprobado','contactado','en_conversacion','interesado','reunion_agendada','demo_realizada','propuesta_enviada','negociacion','ganado','perdido','pausado','no_contactar')),
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
  -- pipeline comercial (P0)
  proxima_accion TEXT NOT NULL DEFAULT '',
  motivo_perdida TEXT NOT NULL DEFAULT '' CHECK (motivo_perdida IN ('','sin_respuesta','no_interesado','precio','sin_presupuesto','ya_tiene_proveedor','no_es_momento','fuera_de_perfil','otro')),
  fecha_demo TEXT NOT NULL DEFAULT '',
  fecha_propuesta TEXT NOT NULL DEFAULT '',
  monto_implementacion TEXT NOT NULL DEFAULT '' CHECK (monto_implementacion = '' OR monto_implementacion NOT GLOB '*[^0-9.]*'),
  monto_mensual TEXT NOT NULL DEFAULT '' CHECK (monto_mensual = '' OR monto_mensual NOT GLOB '*[^0-9.]*'),
  criterios TEXT NOT NULL DEFAULT '' CHECK (criterios = '' OR json_valid(criterios)),
  -- reglas transversales
  CHECK (aprobacion_estado <> 'aprobado' OR (aprobado_por <> '' AND fecha_aprobacion <> '')),
  CHECK (lower(aprobado_por) NOT IN ('claude','agente','agent','lead-researcher','lead-qualifier','outreach-writer','crm-manager','follow-up-manager','compliance-reviewer','n8n','sistema','bot','ia','ai','cli','crm_tool','dashboard','api','worker','investigador')),
  CHECK (opt_out = 'false' OR (estado_pipeline = 'no_contactar' AND fecha_opt_out <> '')),
  CHECK (estado_pipeline NOT IN ('contactado','en_conversacion','interesado','reunion_agendada','demo_realizada','propuesta_enviada','negociacion','pausado')
         OR (proximo_seguimiento <> '' AND proxima_accion <> '')),
  CHECK (estado_pipeline <> 'perdido' OR motivo_perdida <> ''),
  CHECK (estado_pipeline <> 'demo_realizada' OR fecha_demo <> ''),
  CHECK (estado_pipeline NOT IN ('propuesta_enviada','negociacion') OR fecha_propuesta <> '')
);

-- ------------------------------------------------------------------ interacciones (sin cambios respecto a 0003)
CREATE TABLE interactions (
  interaccion_id TEXT PRIMARY KEY CHECK (length(interaccion_id) = 17 AND substr(interaccion_id, 1, 4) = 'INT-' AND substr(interaccion_id, 13, 1) = '-'
    AND (substr(interaccion_id, 5, 8) || substr(interaccion_id, 14, 4)) NOT GLOB '*[^0-9]*'),
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

-- ------------------------------------------------------------------ seguimientos (sin cambios respecto a 0003)
CREATE TABLE followups (
  seguimiento_id TEXT PRIMARY KEY CHECK (length(seguimiento_id) = 16 AND substr(seguimiento_id, 1, 3) = 'FU-' AND substr(seguimiento_id, 12, 1) = '-'
    AND (substr(seguimiento_id, 4, 8) || substr(seguimiento_id, 13, 4)) NOT GLOB '*[^0-9]*'),
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

-- ------------------------------------------------------------------ copia de filas (columnas explícitas: las nuevas quedan vacías)
INSERT INTO leads (lead_id,fecha_registro,fuente,fuente_url,fecha_fuente,nombre_negocio,nombre_normalizado,nicho,subnicho,ciudad,estado_mx,zona_horaria,
  direccion,google_maps_url,google_place_id,sitio_web,dominio,telefono_publico,telefono_e164,whatsapp_publico,email_publico,instagram_url,facebook_url,
  otras_fuentes,decisor_nombre,decisor_cargo,decisor_fuente_url,num_resenas,calificacion_google,senales_oportunidad,evidencias,servicio_recomendado,
  puntaje_icp,puntaje_oportunidad,puntaje_contacto,puntaje_capacidad,puntaje_total,clasificacion,motivo_clasificacion,estado_pipeline,canal_preferido,
  mensaje_inicial_id,aprobacion_estado,aprobado_por,fecha_aprobacion,fecha_primer_contacto,fecha_ultima_interaccion,proximo_seguimiento,num_seguimientos,
  consentimiento_whatsapp,fecha_consentimiento,opt_out,fecha_opt_out,responsable,notas,fecha_actualizacion,
  proxima_accion,motivo_perdida,fecha_demo,fecha_propuesta,monto_implementacion,monto_mensual)
SELECT lead_id,fecha_registro,fuente,fuente_url,fecha_fuente,nombre_negocio,nombre_normalizado,nicho,subnicho,ciudad,estado_mx,zona_horaria,
  direccion,google_maps_url,google_place_id,sitio_web,dominio,telefono_publico,telefono_e164,whatsapp_publico,email_publico,instagram_url,facebook_url,
  otras_fuentes,decisor_nombre,decisor_cargo,decisor_fuente_url,num_resenas,calificacion_google,senales_oportunidad,evidencias,servicio_recomendado,
  puntaje_icp,puntaje_oportunidad,puntaje_contacto,puntaje_capacidad,puntaje_total,clasificacion,motivo_clasificacion,estado_pipeline,canal_preferido,
  mensaje_inicial_id,aprobacion_estado,aprobado_por,fecha_aprobacion,fecha_primer_contacto,fecha_ultima_interaccion,proximo_seguimiento,num_seguimientos,
  consentimiento_whatsapp,fecha_consentimiento,opt_out,fecha_opt_out,responsable,notas,fecha_actualizacion,
  proxima_accion,motivo_perdida,fecha_demo,fecha_propuesta,monto_implementacion,monto_mensual
FROM _old_leads;
INSERT INTO interactions SELECT * FROM _old_interactions;
INSERT INTO followups SELECT * FROM _old_followups;

DROP TABLE _old_followups;
DROP TABLE _old_interactions;
DROP TABLE _old_leads;

-- ------------------------------------------------------------------ índices (idénticos a 0003)
CREATE UNIQUE INDEX ux_leads_tel ON leads(telefono_e164) WHERE telefono_e164 <> '';
CREATE UNIQUE INDEX ux_leads_email ON leads(lower(email_publico)) WHERE email_publico <> '';
CREATE UNIQUE INDEX ux_leads_dominio ON leads(dominio) WHERE dominio <> '';
CREATE UNIQUE INDEX ux_leads_place ON leads(google_place_id) WHERE google_place_id <> '';
CREATE INDEX ix_leads_estado ON leads(estado_pipeline);
CREATE INDEX ix_leads_nombre_ciudad ON leads(nombre_normalizado, ciudad);
CREATE INDEX ix_leads_seguimiento ON leads(proximo_seguimiento) WHERE proximo_seguimiento <> '';
CREATE INDEX ix_int_lead ON interactions(lead_id, fecha_hora);
CREATE INDEX ix_fu_fecha ON followups(fecha_programada, estado);

-- ------------------------------------------------------------------ triggers (idénticos a 0003)
CREATE TRIGGER trg_int_no_update BEFORE UPDATE ON interactions
BEGIN SELECT RAISE(ABORT, 'interactions es historial inmutable'); END;
CREATE TRIGGER trg_int_no_delete BEFORE DELETE ON interactions
BEGIN SELECT RAISE(ABORT, 'interactions es historial inmutable'); END;

CREATE TRIGGER trg_fu_no_delete BEFORE DELETE ON followups
BEGIN SELECT RAISE(ABORT, 'los seguimientos se cancelan, no se borran'); END;
CREATE TRIGGER trg_fu_closed BEFORE UPDATE ON followups
WHEN OLD.estado IN ('enviado','cancelado')
BEGIN SELECT RAISE(ABORT, 'seguimiento cerrado: no se modifica'); END;

CREATE TRIGGER trg_leads_no_delete BEFORE DELETE ON leads
BEGIN SELECT RAISE(ABORT, 'los leads se cierran con estados, no se borran'); END;

CREATE TRIGGER trg_leads_baja_irreversible BEFORE UPDATE ON leads
WHEN OLD.opt_out = 'true' OR OLD.estado_pipeline = 'no_contactar'
BEGIN SELECT RAISE(ABORT, 'lead dado de baja / no_contactar: no se modifica ni se reactiva'); END;

CREATE TRIGGER trg_leads_identidad BEFORE UPDATE ON leads
WHEN NEW.lead_id <> OLD.lead_id OR NEW.fecha_registro <> OLD.fecha_registro OR NEW.fuente <> OLD.fuente OR NEW.fuente_url <> OLD.fuente_url
BEGIN SELECT RAISE(ABORT, 'lead_id, fecha_registro y fuente son inmutables'); END;

CREATE TRIGGER trg_leads_transicion BEFORE UPDATE OF estado_pipeline ON leads
WHEN NEW.estado_pipeline <> OLD.estado_pipeline
 AND NOT (NEW.estado_pipeline = 'no_contactar' AND OLD.estado_pipeline NOT IN ('ganado'))
 AND NOT EXISTS (SELECT 1 FROM allowed_transitions WHERE desde = OLD.estado_pipeline AND hacia = NEW.estado_pipeline)
BEGIN SELECT RAISE(ABORT, 'transición de estado no permitida'); END;

CREATE TRIGGER trg_leads_suprimido BEFORE INSERT ON leads
WHEN EXISTS (SELECT 1 FROM suppression s WHERE
     (s.tipo = 'telefono_e164' AND s.valor IN (NEW.telefono_e164, NEW.whatsapp_publico) AND s.valor <> '')
  OR (s.tipo = 'email' AND s.valor = lower(NEW.email_publico) AND s.valor <> '')
  OR (s.tipo = 'dominio' AND s.valor = NEW.dominio AND s.valor <> '')
  OR (s.tipo = 'google_place_id' AND s.valor = NEW.google_place_id AND s.valor <> '')
  OR (s.tipo = 'nombre_ciudad' AND s.valor = NEW.nombre_normalizado || '|' || lower(NEW.ciudad)))
BEGIN SELECT RAISE(ABORT, 'el negocio está en la lista de exclusión'); END;
