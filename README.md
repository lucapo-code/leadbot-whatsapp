# leadbot-whatsapp

Chatbot de WhatsApp para **calificar leads** con un flujo conversacional **configurable por JSON**, sin inteligencia artificial generativa: cada paso es fijo y predecible, lo cual facilita auditar exactamente qué pregunta y cuándo.

Pensado para negocios que reciben prospectos de campañas digitales (ventas, servicios, cotizaciones) y necesitan:
- Hacer preguntas condicionales según el servicio elegido
- Capturar datos específicos del prospecto (ubicación, volumen, fecha, etc.)
- Calificar automáticamente según reglas de negocio (zona, volumen, presupuesto)
- Transferir los leads calificados a un agente humano, con todo el contexto recopilado
- Dejar un registro (`leads.jsonl`) de cada conversación para seguimiento o CRM

## Cómo funciona

El flujo se define en un archivo JSON (ver `flujos/ejemplo_paisajismo.json`): una serie de **nodos**, cada uno con su mensaje, en qué variable guardar la respuesta, y a qué nodo ir después. Incluye un nodo especial de "lógica" que decide si el lead califica, según las reglas en `criterios_calificacion`.

```bash
npm install
LEADBOT_HUMANO="5215512345678" node bot.mjs   # numero (sin +) que recibe los leads calificados
```

Al correrlo por primera vez pide vincular WhatsApp (QR o código de emparejamiento, vía Baileys).

## Adaptar a otro negocio

1. Copiá `flujos/ejemplo_paisajismo.json` y editá los nodos: mensajes, variables a capturar, y los criterios de `calificaLead()` en `bot.mjs` (está aislada en una sola función, fácil de ajustar).
2. Apuntá `LEADBOT_FLUJO` al nuevo archivo.

## Qué no incluye (a propósito)

No usa un modelo de lenguaje para responder: es 100% flujo fijo, tal como pide la mayoría de clientes para esta primera etapa (previsible, sin alucinaciones, fácil de auditar). Se puede agregar un nodo que consulte un LLM para casos abiertos, como mejora a futuro.
