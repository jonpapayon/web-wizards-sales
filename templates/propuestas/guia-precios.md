# Guía interna de precios — Web Wizards

**Uso interno. No se envía al cliente.** Los precios solo aparecen en propuestas que prepara, revisa y envía una persona (nunca en el primer mensaje ni en respuestas automáticas). Son precios de prueba para validar el mercado: se ajustan con datos reales del CRM (`monto_implementacion`, `monto_mensual`, `motivo_perdida`).

---

## 1. Módulos y precios de referencia (lanzamiento)

| Módulo | Para quién | Implementación lanzamiento | Implementación referencia | Mensual lanzamiento | Mensual referencia |
|---|---|---|---|---|---|
| **A. Citas por WhatsApp** (base) | Negocios con citas: clínicas, dentistas, estéticas, veterinarias, belleza | $6,000 | $10,000 | $1,500 | $2,000 |
| **C. + Agente IA** (preguntas frecuentes, captura de datos, paso a una persona) | Alto volumen de preguntas repetidas | +$5,000 | +$8,000 | +$1,000 | +$1,500 |
| **D. + Sitio de conversión** | Sin sitio, sitio roto o que no lleva a contacto | +$6,000 | +$9,000 | incluido en el mensual | — |
| **B. Seguimiento comercial** | Inmobiliarias, autos, solar, construcción, educación | $8,000 | $14,000 | $2,000 | $2,500 |
| **F. Reputación** (solicitud de reseñas, reactivación) | Ya tienen base de clientes | $3,000 | $5,000 | $800 | $1,200 |
| **E. Sistema interno / inventarios** | Retail, distribución | Cotización por diagnóstico | — | Cotización | — |

Paquete completo A + C + D (equivalente a "Presencia digital + agente IA"): **$17,000 de lanzamiento** ($27,000 de referencia), **$2,500 al mes**. Nunca se vende un proyecto E con mensualidad genérica.

## 2. Piso: lo que cuesta hacerlo (no vender por debajo)

| Módulo | Horas estimadas | × tarifa interna | Piso |
|---|---|---|---|
| A. Citas por WhatsApp | 12–16 h | $450/h | ~$5,400–7,200 |
| C. Agente IA | 10–14 h | $450/h | ~$4,500–6,300 |
| D. Sitio | 12–14 h | $450/h | ~$5,400–6,300 |

Mensualidad mínima = horas de soporte al mes (2–3 h × $450) + costos externos incluidos + margen ≥ 40 %.
Actualiza la tarifa interna y las horas reales al cerrar cada proyecto: el piso debe salir de datos, no de intuición.

## 3. Techo: lo que vale para el cliente (cómo argumentar)

Cálculo con datos del propio cliente, nunca con cifras inventadas:

```
Citas perdidas al mes (que el cliente estime) × valor promedio de su cita = dinero que se pierde al mes
```

Ejemplo de conversación: «Si un recordatorio evita 4 citas perdidas al mes y cada cita vale $800 para ustedes, son $3,200 al mes; el servicio cuesta $1,500». Si el cliente no conoce sus números, se le pregunta; **no se promete un resultado** (no garantizamos reducción de inasistencias).

## 4. Costos externos (siempre aparte o con tope)

| Concepto | Quién lo paga | Cómo se cobra |
|---|---|---|
| WhatsApp Business Platform (mensajes de plantilla: confirmaciones, recordatorios) | El cliente | A costo, con su método de pago en Meta, o incluido hasta un tope de conversaciones al mes. **Verificar la tarifa vigente de Meta para México antes de cada propuesta.** |
| Modelo de IA (agente) | El cliente | Incluido hasta un tope de uso; excedente a costo. |
| Dominio y hosting del sitio | El cliente | A costo anual, a su nombre. |
| Licencias (Google Workspace, agenda, etc.) | El cliente | A su nombre. |

Las cuentas (Meta, dominio, Google) quedan **a nombre del cliente**: evita dependencia y disputas.

## 5. Reglas de negociación

1. **No bajar precio: quitar alcance.** «Es caro» → ofrecer solo el módulo A. Bajar el precio enseña que es negociable.
2. **Lanzamiento con cupo:** primeros 5 clientes, a cambio de testimonio o caso de estudio con permiso. Registrar en notas del lead.
3. **Pago:** implementación 50 % al iniciar y 50 % al entregar; mensualidad por adelantado, desde la puesta en marcha.
4. **Permanencia mínima** de la mensualidad: 3 meses (cubre la curva de ajuste). Cancelación con 30 días de aviso.
5. **Sin descuentos automáticos.** Cualquier excepción la decide una persona y queda anotada en el CRM.
6. **Registrar siempre** en el CRM: `fecha_propuesta`, `monto_implementacion`, `monto_mensual`; si se pierde, `motivo_perdida` (`precio`, `sin_presupuesto`, `no_es_momento`, …).

## 6. Cuándo ajustar precios (con datos, no con nervios)

Revisar cada 10 propuestas enviadas:
- **≥ 50 % pierde por `precio` o `sin_presupuesto`:** revisar alcance del módulo base o el segmento (quizá no es el cliente ideal), antes que bajar el precio.
- **Nadie objeta el precio y se cierra > 40 %:** el precio está bajo; subir hacia el de referencia con los siguientes clientes.
- Pocas muestras (< 10 propuestas) no son suficientes para concluir.
