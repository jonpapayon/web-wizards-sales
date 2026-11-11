# Cumplimiento: privacidad, comunicaciones comerciales y plataformas

Guía operativa. **No es asesoría legal.** Antes de aumentar el volumen o activar automatizaciones, Web Wizards debe validar estos puntos con un abogado en México y revisar las políticas vigentes de cada plataforma.

Reglas operativas que **no** se repiten aquí:
- Bajas: `policies/opt-out.md`.
- Consentimiento y canales permitidos: `policies/consent.md`.
- Frecuencia, horarios y límites: `policies/contact-cadence.md`.

## 1. Datos que se recopilan
- **Sí:** datos de contacto que el negocio publica como canal comercial (teléfono, WhatsApp publicado, email, formulario, redes del negocio), dirección comercial, servicios, reseñas en conjunto (número y calificación) y presencia web.
- **Solo si el negocio lo publica:** nombre y cargo del titular o director. Es un dato personal: se usa solo en el saludo y con su URL de origen.
- **Nunca:** celulares personales, redes personales, domicilios particulares, datos de pacientes o clientes, información de salud, nombres de autores de reseñas, ni datos obtenidos iniciando sesión o eludiendo restricciones.

Minimización: un dato que no se usa para calificar o contactar no se guarda.

## 2. Privacidad (México)
- La **Ley Federal de Protección de Datos Personales en Posesión de los Particulares** aplica a los datos de personas físicas (por ejemplo, un dentista que ejerce como persona física y publica su nombre y teléfono).
- Pendientes de Web Wizards (fuera del alcance del agente):
  - [ ] Aviso de privacidad publicado y enlazable.
  - [ ] Procedimiento para solicitudes de acceso, rectificación, cancelación y oposición (ARCO).
  - [ ] Plazo de retención de leads no convertidos (sugerido: 12 meses sin interacción → anonimizar).
- **Solicitud de supresión de datos (ARCO):** la ejecuta manualmente una persona autorizada. Requiere quitar la bandera de solo anexado (`chflags nouappnd`), que el agente no puede usar. Se elimina el dossier y se anonimiza el registro, conservando en supresión solo el valor mínimo para no volver a contactar.

## 3. Comunicaciones comerciales
- Respetar la **Ley Federal de Protección al Consumidor** y las disposiciones de PROFECO sobre publicidad: identificar al remitente, no engañar y respetar la solicitud de no recibir publicidad.
- **REPEP** (Registro Público para Evitar Publicidad, de PROFECO): pendiente definir con asesoría legal si aplica a la prospección B2B de Web Wizards y cómo consultarlo antes de llamar o enviar mensajes. Si un número resulta inscrito: `crm_tool.py suppress --motivo repep`.

## 4. WhatsApp
Las reglas de uso están en `policies/consent.md`. Aquí solo el riesgo de plataforma: una tasa alta de bloqueos o reportes reduce la calificación de calidad del número y puede restringir la cuenta. Hay que vigilarla desde el primer envío.

## 5. Email
- Remitente real y dominio propio de Web Wizards con SPF, DKIM y DMARC configurados (pendiente técnico).
- Asunto no engañoso, firma con identificación y frase de baja.
- Nunca listas compradas ni correos deducidos.

## 6. Plataformas de investigación
- Google Maps y Búsqueda, Meta (Facebook, Instagram, Ad Library), Doctoralia y directorios: consulta pública conforme a sus términos. Para volumen, preferir APIs oficiales autorizadas (por ejemplo, Google Places API) en lugar de extracción automatizada.
- Nunca crear cuentas falsas, iniciar sesión para extraer datos ni evadir límites, CAPTCHAs o bloqueos.

## 7. Señales de alto riesgo → detener y escalar
Queja formal, mención de PROFECO, de la autoridad de protección de datos o de un abogado, solicitud ARCO, reporte de spam, insultos, solicitud de borrar datos, contacto con un menor o datos de pacientes en una respuesta.
