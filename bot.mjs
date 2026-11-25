// leadbot-whatsapp: motor de flujo conversacional configurable por JSON.
// Sin IA generativa: cada paso es un nodo fijo (mensaje + donde guardar
// la respuesta + a que nodo ir despues). Pensado para calificar leads y
// pasarlos a un humano cuando corresponde.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs'
import os from 'os'
import path from 'path'

const HOME = os.homedir()
const DIR = path.join(HOME, 'leadbot-whatsapp')
const logger = pino({ level: 'silent' })

// --- Configuracion editable ---
const RUTA_FLUJO = process.env.LEADBOT_FLUJO || path.join(DIR, 'flujos', 'ejemplo_paisajismo.json')
const NUMERO_HUMANO = process.env.LEADBOT_HUMANO || null // ej: "5215512345678" (sin +)
const flujo = JSON.parse(fs.readFileSync(RUTA_FLUJO, 'utf8'))

const RUTA_LEADS = path.join(DIR, 'leads.jsonl')
const estados = new Map() // jid -> { nodo, variables }

const ts = () => new Date().toTimeString().slice(0, 8)
const log = (...a) => console.log(ts(), ...a)
const user = (jid) => (jid || '').split('@')[0].split(':')[0]

function normalizar(txt) {
  return (txt || '').trim().toLowerCase()
}

// Decide si el lead califica segun los criterios del flujo (zona + volumen).
// Esta funcion es el unico lugar con "logica de negocio": cambiala segun
// el proyecto real (acá va un ejemplo generico de zona + cantidad minima).
function calificaLead(variables, criterios) {
  if (!criterios) return true
  const zonaOk = !criterios.zona_valida || criterios.zona_valida.some(
    (z) => normalizar(variables.ubicacion_texto || '').includes(normalizar(z))
  )
  const cantidadNum = parseInt(String(variables.cantidad || '').replace(/\D/g, ''), 10) || 0
  const volumenOk = !criterios.volumen_minimo || cantidadNum >= criterios.volumen_minimo
  return zonaOk || volumenOk // con cualquiera de los dos alcanza (regla de ejemplo)
}

function textoDelNodo(nodo, variables) {
  if (nodo.mensaje_por_servicio && variables.servicio) {
    return nodo.mensaje_por_servicio[variables.servicio] || nodo.mensaje
  }
  return nodo.mensaje
}

function guardarLead(jid, variables, califico) {
  const registro = { fecha: new Date().toISOString(), de: user(jid), variables, califico }
  fs.appendFileSync(RUTA_LEADS, JSON.stringify(registro) + '\n')
  return registro
}

async function manejarMensaje(sock, jid, texto) {
  let st = estados.get(jid)
  if (!st) {
    st = { nodo: flujo.inicio, variables: {} }
    estados.set(jid, st)
  }

  const nodoActual = flujo.nodos[st.nodo]

  // Si el nodo anterior pedia capturar algo, lo guardamos con lo que
  // la persona acaba de responder (resolviendo opciones numeradas si las hay).
  if (nodoActual.capturar_en) {
    let valor = texto
    if (nodoActual.opciones && nodoActual.opciones[texto.trim()]) {
      valor = nodoActual.opciones[texto.trim()]
    }
    st.variables[nodoActual.capturar_en] = valor
  }

  let siguienteId = nodoActual.siguiente
  let nodoAEnviar = nodoActual

  // Nodo de logica pura (no manda mensaje, solo decide a donde saltar)
  if (nodoActual.tipo === 'logica') {
    const califico = calificaLead(st.variables, flujo.criterios_calificacion)
    siguienteId = califico ? nodoActual.siguiente_si_califica : nodoActual.siguiente_si_no_califica
    const registro = guardarLead(jid, st.variables, califico)
    log(user(jid), califico ? 'LEAD CALIFICADO' : 'lead no calificado', JSON.stringify(st.variables))
    nodoAEnviar = flujo.nodos[siguienteId]
    if (califico && nodoAEnviar.accion === 'notificar_humano' && NUMERO_HUMANO) {
      const resumen = Object.entries(st.variables).map(([k, v]) => `• ${k}: ${v}`).join('\n')
      await sock.sendMessage(NUMERO_HUMANO + '@s.whatsapp.net', {
        text: `🟢 Lead calificado de ${user(jid)}:\n${resumen}`,
      })
    }
  }

  if (nodoAEnviar.mensaje || nodoAEnviar.mensaje_por_servicio) {
    await sock.sendMessage(jid, { text: textoDelNodo(nodoAEnviar, st.variables) })
  }

  if (nodoAEnviar.fin) {
    estados.delete(jid) // conversacion terminada; la proxima vez empieza de cero
  } else {
    st.nodo = siguienteId
  }
}

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(DIR, 'sesion'))
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    version, logger, auth: state, printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), syncFullHistory: false, markOnlineOnConnect: false,
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) log('Escaneá este QR (o usá requestPairingCode si preferís vincular por codigo):', qr.slice(0, 40) + '...')
    if (connection === 'open') log('conectado como', sock.user?.id)
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      log('conexion cerrada', code)
      if (code === DisconnectReason.loggedOut) { log('sesion cerrada; borra la carpeta sesion para vincular de nuevo'); process.exit(0) }
      setTimeout(iniciar, 4000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) {
      if (m.key.fromMe) continue
      const jid = m.key.remoteJid
      if (!jid || jid.endsWith('@g.us')) continue // ignora grupos, solo chats 1 a 1
      const texto = m.message?.conversation || m.message?.extendedTextMessage?.text || ''
      if (!texto) continue
      try {
        await manejarMensaje(sock, jid, texto)
      } catch (e) {
        log('error manejando mensaje de', user(jid), e.message)
      }
    }
  })
}

iniciar()
