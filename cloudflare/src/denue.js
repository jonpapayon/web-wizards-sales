// Conector oficial INEGI DENUE (https://www.inegi.org.mx/servicios/api_denue.html).
// El token (DENUE_TOKEN) es un secreto: nunca se guarda en la base, en la caché ni en los registros.
// Caché en D1 (source_cache), paginación por registro inicial/final, control de errores. No inventa datos faltantes.
import { first, q } from "./db.js";
import { nowIso, CRMError, normalizeName, stripAccents } from "./rules.js";

export const DENUE_BASE = "https://www.inegi.org.mx/app/api/denue/v1/consulta";
export const DENUE_PUBLIC = "https://www.inegi.org.mx/app/mapa/denue/";
// Clases SCIAN 2018 (verificar contra el catálogo oficial de INEGI antes del primer uso en producción).
export const SCIAN = { dentista: ["621211"], clinica: ["621111", "621113"], estetica_spa: ["812110"], veterinaria: ["541941"] };
export const KEYWORDS = { dentista: "dental", clinica: "consultorio", estetica_spa: "estetica", veterinaria: "veterinari" };
export const ENTIDADES = { "aguascalientes": "01", "baja california": "02", "baja california sur": "03", "campeche": "04", "coahuila": "05",
  "coahuila de zaragoza": "05", "colima": "06", "chiapas": "07", "chihuahua": "08", "ciudad de mexico": "09", "cdmx": "09", "durango": "10",
  "guanajuato": "11", "guerrero": "12", "hidalgo": "13", "jalisco": "14", "mexico": "15", "estado de mexico": "15", "michoacan": "16",
  "michoacan de ocampo": "16", "morelos": "17", "nayarit": "18", "nuevo leon": "19", "oaxaca": "20", "puebla": "21", "queretaro": "22",
  "queretaro de arteaga": "22", "quintana roo": "23", "san luis potosi": "24", "sinaloa": "25", "sonora": "26", "tabasco": "27",
  "tamaulipas": "28", "tlaxcala": "29", "veracruz": "30", "veracruz de ignacio de la llave": "30", "yucatan": "31", "zacatecas": "32" };
export const cveEntidad = (estado) => ENTIDADES[normalizeName(estado)] || null;
const PAGE = 100;
const TTL_DAYS = 7;
const seg = (v) => encodeURIComponent(String(v).trim()).replace(/%2C/g, ",");

export function buildUrl(method, params, token) {
  const t = token ? `/${encodeURIComponent(token)}` : "/{token}";
  switch (method) {
    case "Buscar": return `${DENUE_BASE}/Buscar/${seg(params.condicion || "todos")}/${params.lat},${params.lon}/${Math.min(5000, params.metros || 1000)}${t}`;
    case "Ficha": return `${DENUE_BASE}/Ficha/${seg(params.id)}${t}`;
    case "Nombre": return `${DENUE_BASE}/Nombre/${seg(params.nombre)}/${params.entidad || "00"}/${params.ini || 1}/${params.fin || PAGE}${t}`;
    case "BuscarEntidad": return `${DENUE_BASE}/BuscarEntidad/${seg(params.condicion || "todos")}/${params.entidad || "00"}/${params.ini || 1}/${params.fin || PAGE}${t}`;
    case "BuscarAreaAct": {
      const p = params;
      return `${DENUE_BASE}/BuscarAreaAct/${p.entidad || "00"}/${p.municipio || 0}/${p.localidad || 0}/${p.ageb || 0}/${p.manzana || 0}/${p.sector || 0}/${p.subsector || 0}/${p.rama || 0}/${p.clase || 0}/${seg(p.nombre || 0)}/${p.ini || 1}/${p.fin || PAGE}/${p.id || 0}${t}`;
    }
    default: throw new CRMError(`Método DENUE no soportado: ${method}`);
  }
}

// Llama a la API con caché. fetchImpl se inyecta en pruebas.
export async function denueCall(env, method, params, { fetchImpl = fetch, force = false } = {}) {
  if (!env.DENUE_TOKEN) throw new CRMError("DENUE_TOKEN no configurado: el conector está preparado pero no conectado. Ver docs/DESPLIEGUE.md.", 503);
  const key = buildUrl(method, params, null);  // clave de caché SIN token
  if (!force) {
    const c = await first(env, "SELECT respuesta, consultado_en FROM source_cache WHERE fuente = 'denue' AND clave = ? AND expira_en > ?", key, nowIso());
    if (c) return { datos: JSON.parse(c.respuesta), consultado_en: c.consultado_en, cache: true };
  }
  let r;
  try { r = await fetchImpl(buildUrl(method, params, env.DENUE_TOKEN), { headers: { Accept: "application/json" } }); }
  catch (e) { throw new CRMError(`DENUE no respondió: ${e.message}`, 502); }
  const text = await r.text();
  if (!r.ok) throw new CRMError(`DENUE respondió HTTP ${r.status}${r.status === 401 || r.status === 403 ? " (¿token inválido?)" : ""}`, 502);
  let datos;
  try { datos = JSON.parse(text); } catch { throw new CRMError(`DENUE devolvió una respuesta no JSON (${text.slice(0, 80).replace(/\s+/g, " ")}). Puede ser un token inválido o un cambio de la API.`, 502); }
  if (!Array.isArray(datos)) datos = datos && typeof datos === "object" ? [datos] : [];
  const consultado = nowIso();
  const expira = new Date(Date.now() + TTL_DAYS * 864e5).toISOString().slice(0, 19) + "-06:00";
  await q(env, "INSERT OR REPLACE INTO source_cache (fuente, clave, respuesta, consultado_en, expira_en) VALUES ('denue', ?, ?, ?, ?)", key, JSON.stringify(datos), consultado, expira).run();
  return { datos, consultado_en: consultado, cache: false };
}

// Paginación: pide páginas de PAGE registros hasta reunir `max` o agotar resultados.
export async function denuePaged(env, method, params, max, opts) {
  const out = []; let consultado = null;
  for (let ini = 1; out.length < max && ini <= 5000; ini += PAGE) {
    const r = await denueCall(env, method, { ...params, ini, fin: ini + PAGE - 1 }, opts);
    consultado = consultado || r.consultado_en;
    out.push(...r.datos);
    if (r.datos.length < PAGE) break;
  }
  return { datos: out.slice(0, max), consultado_en: consultado };
}

const clean = (v) => (v == null ? "" : String(v).trim());
export function phoneE164(tel) {
  const d = clean(tel).replace(/\D/g, "");
  if (d.length === 10) return "+52" + d;
  if (d.length === 12 && d.startsWith("52")) return "+" + d;
  return "";  // incompleto o ambiguo: no se completa (no inventar)
}
export function normalizeSite(s) {
  const v = clean(s).toLowerCase();
  if (!v || v === "0" || v === "na" || v === "n/a") return "";
  return /^https?:\/\//.test(v) ? v : "http://" + v;
}

// Ficha DENUE → negocio para el motor (solo datos presentes; lo que falta se lista como no encontrado en DENUE).
export function toBusiness(e, consultado_en) {
  const dir = [clean(e.Tipo_vialidad), clean(e.Calle), clean(e.Num_Exterior), clean(e.Num_Interior) && `int. ${clean(e.Num_Interior)}`,
    clean(e.Colonia) && `col. ${clean(e.Colonia)}`, clean(e.CP) && `CP ${clean(e.CP)}`].filter(Boolean).join(" ");
  const ubic = clean(e.Ubicacion).split(",").map((s) => s.trim());
  const b = { fuente: "denue", ref_id: clean(e.Id) || clean(e.CLEE), clee: clean(e.CLEE), nombre_negocio: clean(e.Nombre) || clean(e.Razon_social),
    razon_social: clean(e.Razon_social), clase_actividad: clean(e.Clase_actividad), estrato: clean(e.Estrato), direccion: dir,
    municipio: ubic.length >= 2 ? ubic[ubic.length - 2] : "", estado_mx: ubic.length >= 1 ? ubic[ubic.length - 1] : "", ubicacion: clean(e.Ubicacion),
    telefono_publico: clean(e.Telefono), telefono_e164: phoneE164(e.Telefono), email_publico: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(e.Correo_e)) ? clean(e.Correo_e).toLowerCase() : "",
    sitio_web: normalizeSite(e.Sitio_internet), latitud: clean(e.Latitud), longitud: clean(e.Longitud), consultado_en, fuente_url: DENUE_PUBLIC };
  b.no_encontrado_denue = ["telefono_publico", "email_publico", "sitio_web"].filter((k) => !b[k]);
  return b;
}
export const pymeFromEstrato = (estrato) => /^(0 a 5|6 a 10|11 a 30|31 a 50)/.test(clean(estrato));
// Ubicacion de DENUE: "LOCALIDAD, Municipio, ESTADO". Se compara con el municipio o la localidad, nunca con el estado
// (p. ej. «San Andrés Cholula, PUEBLA» no es el municipio de Puebla).
export function inMunicipio(b, municipio) {
  if (!municipio) return true;
  const m = normalizeName(municipio);
  const parts = clean(b.ubicacion).split(",").map((s) => normalizeName(s));
  const lugar = parts.slice(0, -1);  // sin el estado
  return normalizeName(b.municipio) === m || lugar.includes(m);
}
