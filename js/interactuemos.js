/* =====================================================================
   interactuemos.js — "¿interactuemos?" de la página sobre mí
   ---------------------------------------------------------------------
   1. Monta la mano cromada en 3D (modelos-3d/mano-cromada.js).
   2. Desktop: el botón "conectar" pide la cámara y carga MediaPipe.
      Cuando la persona abre la mano frente a la cámara (y la mantiene
      abierta un instante) la mano 3D se deshace en píxeles.
   3. Mobile: no hay cámara ni botón; la mano late suave y se toca.
   4. Acceso simple: el texto lateral hace lo mismo sin cámara.
   5. Al terminar, se ocultan la mano y la cámara, y aparecen el CD y el
      contacto.
   ===================================================================== */
import { crearManoCromada } from '../modelos-3d/mano-cromada.js';

// Versión fija de MediaPipe (así un cambio de la librería no rompe la página)
const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODELO_MANO = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const MANTENER_ABIERTA = 650;   // ms que la mano debe estar abierta para entrar
const TOLERANCIA = 200;         // ms que se perdona si la detección parpadea

const esTactil = window.matchMedia('(hover: none)').matches;
const movimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const aRem = (px) => `${px / 16}rem`;

const seccion = document.getElementById('interactuemos');

if (seccion) iniciar();

function iniciar() {
  const titulo = seccion.querySelector('.interactuemos__titulo');
  const lugarMano = seccion.querySelector('.interactuemos__mano');
  const botonConectar = seccion.querySelector('.boton-conectar');
  const estado = seccion.querySelector('.interactuemos__estado');
  const lateral = seccion.querySelector('.interactuemos__lateral');
  const camara = seccion.querySelector('.camara');
  const lienzoCamara = seccion.querySelector('.camara__imagen');
  const modoCamara = seccion.querySelector('.camara__modo');
  const progreso = seccion.querySelector('.camara__progreso');
  const franjaGlitch = seccion.querySelector('.interactuemos__glitch');
  const ocultas = [document.getElementById('sobre-mi'), document.getElementById('contacto')];

  if (esTactil) seccion.classList.add('interactuemos--tactil');
  if (movimientoReducido) document.documentElement.classList.add('movimiento-reducido');

  /* --- la mano 3D --- */
  let mano = null;
  try {
    mano = crearManoCromada(lugarMano, { movimientoReducido });
  } catch (error) {
    // Sin WebGL2: queda un botón de texto en lugar de la mano
    console.error('No se pudo crear la mano 3D:', error);
    seccion.classList.add('interactuemos--sin-3d');
    lugarMano.textContent = esTactil ? 'toca aquí para entrar' : 'abre tu mano o usa el texto de la izquierda';
  }

  /* --- mobile: la mano es un botón que late --- */
  if (esTactil) {
    lugarMano.setAttribute('role', 'button');
    lugarMano.setAttribute('tabindex', '0');
    lugarMano.setAttribute('aria-label', 'tocar la mano para abrir sobre mí');
    mano?.setPulso(true);
    lugarMano.addEventListener('click', () => revelar());
    lugarMano.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); revelar(); }
    });
  }

  lateral.addEventListener('click', () => revelar());

  const glitch = crearFranjaGlitch(franjaGlitch);

  /* -------------------------------------------------------------------
     Cámara + MediaPipe
     ------------------------------------------------------------------- */
  let video = null;
  let detector = null;
  let detectando = false;
  let abiertaDesde = 0;
  let ultimaAbierta = 0;
  let ultimoTiempoVideo = -1;
  const pincel = lienzoCamara.getContext('2d');

  botonConectar.addEventListener('click', conectar);

  async function conectar() {
    if (detectando || revelado) return;
    botonConectar.disabled = true;
    botonConectar.textContent = 'conectando…';
    decir('pidiendo permiso para usar la cámara…');

    try {
      // Se pide la cámara y se carga MediaPipe al mismo tiempo
      const [flujo, deteccion] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
        cargarDetector(),
      ]);
      if (revelado) { flujo.getTracks().forEach((p) => p.stop()); return; }

      detector = deteccion;
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = flujo;
      await video.play();

      botonConectar.textContent = 'conectado';
      botonConectar.classList.add('boton-conectar--activo');
      decir('abre tu mano frente a la cámara ✋');
      camara.classList.add('camara--activa');
      seccion.classList.add('interactuemos--conectado');
      detectando = true;
      requestAnimationFrame(detectar);
    } catch (error) {
      console.error(error);
      apagarCamara();
      botonConectar.disabled = false;
      botonConectar.textContent = 'conectar';
      const sinPermiso = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      decir(sinPermiso
        ? 'no tengo permiso para usar la cámara. puedes entrar con el texto de la izquierda :)'
        : 'no pude encender la cámara. puedes entrar con el texto de la izquierda :)');
    }
  }

  async function cargarDetector() {
    const { FilesetResolver, HandLandmarker } = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
    const archivos = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    const opciones = (delegate) => ({
      baseOptions: { modelAssetPath: MODELO_MANO, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    // Primero intenta con la tarjeta de video; si falla, con el procesador
    try {
      return await HandLandmarker.createFromOptions(archivos, opciones('GPU'));
    } catch {
      return await HandLandmarker.createFromOptions(archivos, opciones('CPU'));
    }
  }

  function detectar() {
    if (!detectando) return;
    requestAnimationFrame(detectar);
    if (video.readyState < 2 || video.currentTime === ultimoTiempoVideo) return;
    ultimoTiempoVideo = video.currentTime;

    const ahora = performance.now();
    const resultado = detector.detectForVideo(video, ahora);
    const puntos = resultado.landmarks?.[0];

    let abierta = false;
    if (puntos) {
      abierta = manoAbierta(puntos);
      // La mano 3D se inclina apenas hacia donde está la mano (la imagen va en espejo)
      mano?.setSeguir(1 - puntos[9].x, puntos[9].y);
    } else {
      mano?.setSeguir(null);
    }

    // Debe mantenerse abierta un momento (así no entra por accidente)
    if (abierta) {
      if (!abiertaDesde || ahora - ultimaAbierta > TOLERANCIA) abiertaDesde = ahora;
      ultimaAbierta = ahora;
    } else if (ahora - ultimaAbierta > TOLERANCIA) {
      abiertaDesde = 0;
    }
    const avance = abiertaDesde ? Math.min(1, (ahora - abiertaDesde) / MANTENER_ABIERTA) : 0;

    dibujarCamara(puntos, abierta);
    progreso.style.transform = `scaleX(${avance})`;
    modoCamara.textContent = !puntos ? 'buscando mano' : abierta ? 'mano abierta' : 'ábrela un poco más';

    if (avance >= 1) revelar();
  }

  // Ventanita: imagen en espejo y los puntos de la mano encima
  function dibujarCamara(puntos, abierta) {
    const w = lienzoCamara.width, h = lienzoCamara.height;
    pincel.save();
    pincel.translate(w, 0);
    pincel.scale(-1, 1);
    // recorta la imagen para llenar la ventana sin deformarla
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(w / vw, h / vh);
    const dx = (w - vw * s) / 2, dy = (h - vh * s) / 2;
    pincel.drawImage(video, dx, dy, vw * s, vh * s);

    if (puntos) {
      const color = abierta ? '#3B7034' : '#142BFF';   // verde musgo / azul del sitio
      pincel.strokeStyle = color;
      pincel.fillStyle = color;
      pincel.lineWidth = 2;
      const xy = (p) => [dx + p.x * vw * s, dy + p.y * vh * s];
      for (const [a, b] of HUESOS) {
        const [x1, y1] = xy(puntos[a]);
        const [x2, y2] = xy(puntos[b]);
        pincel.beginPath();
        pincel.moveTo(x1, y1);
        pincel.lineTo(x2, y2);
        pincel.stroke();
      }
      for (const p of puntos) {
        const [x, y] = xy(p);
        pincel.fillRect(x - 2.5, y - 2.5, 5, 5);
      }
    }
    pincel.restore();
  }

  function apagarCamara() {
    detectando = false;
    video?.srcObject?.getTracks().forEach((pista) => pista.stop());
    if (video) video.srcObject = null;
    detector?.close?.();
    detector = null;
  }

  function decir(texto) { estado.textContent = texto; }

  /* -------------------------------------------------------------------
     Revelar: la mano se deshace y aparecen el CD y el contacto
     ------------------------------------------------------------------- */
  let revelado = false;

  async function revelar() {
    if (revelado) return;
    revelado = true;

    seccion.classList.add('interactuemos--disolviendo');
    camara.classList.remove('camara--activa');
    decir('');
    glitch.intensidad(1);

    // la cámara se apaga apenas empieza el efecto
    setTimeout(apagarCamara, 250);

    if (mano) await mano.disolver();
    else await esperar(400);

    // La sección se cierra (alto a 0) mientras aparece lo de abajo
    const alto = seccion.offsetHeight;
    seccion.style.height = aRem(alto);
    seccion.offsetHeight; // fuerza el cálculo antes de animar
    seccion.classList.add('interactuemos--cerrando');
    seccion.style.height = '0rem';

    ocultas.forEach((el) => {
      if (!el) return;
      el.hidden = false;
      el.classList.add('revelado');
    });
    window.dispatchEvent(new Event('resize')); // el CD 3D toma su tamaño real

    await esperar(movimientoReducido ? 50 : 750);
    mano?.destruir();
    glitch.detener();
    seccion.hidden = true;
    seccion.style.height = '';
  }
}

/* ---------------------------------------------------------------------
   ¿Está abierta la mano?
   Puntos de MediaPipe: 0 muñeca · pulgar 1–4 · índice 5–8 · medio 9–12
                        anular 13–16 · meñique 17–20
   Un dedo está estirado si la punta queda más lejos de la muñeca que su
   articulación del medio y el dedo va casi recto. Además los dedos deben
   estar algo separados entre sí.
   --------------------------------------------------------------------- */
const distancia = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

function dedoEstirado(p, base, medio, punta) {
  const muneca = p[0];
  const lejos = distancia(muneca, p[punta]) > distancia(muneca, p[medio]) * 1.12;
  const v1 = { x: p[medio].x - p[base].x, y: p[medio].y - p[base].y };
  const v2 = { x: p[punta].x - p[medio].x, y: p[punta].y - p[medio].y };
  const recto = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) + 1e-6) > 0.55;
  return lejos && recto;
}

function manoAbierta(p) {
  const palma = distancia(p[0], p[9]);  // tamaño de referencia: muñeca → nudillo del medio
  if (palma < 0.05) return false;        // mano demasiado lejos

  const dedos = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]
    .filter(([b, m, t]) => dedoEstirado(p, b, m, t)).length;
  // pulgar: su punta se aleja del nudillo del índice
  const pulgar = distancia(p[4], p[5]) > palma * 0.55 && distancia(p[4], p[17]) > distancia(p[3], p[17]);
  // separación entre las puntas del índice y el meñique
  const abanico = distancia(p[8], p[20]) / palma > 0.75;

  return dedos === 4 && pulgar && abanico;
}

const HUESOS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------
   Franja de glitch: columna de puntos (trama) que parpadea a saltos.
   Se dibuja a pocos cuadros por segundo para que se sienta "digital".
   --------------------------------------------------------------------- */
function crearFranjaGlitch(lienzo) {
  const ctx = lienzo.getContext('2d');
  const tam = 3;            // px de cada punto
  let fuerza = 0.35;        // cuánto se mueve
  let vivo = true;
  let ultimo = 0;
  let fase = Math.random() * 100;

  function medir() {
    lienzo.width = Math.max(1, Math.round(lienzo.clientWidth));
    lienzo.height = Math.max(1, Math.round(lienzo.clientHeight));
  }
  const ro = new ResizeObserver(medir);
  ro.observe(lienzo);

  const ruido = (x, y) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  function dibujar(t) {
    if (!vivo) return;
    requestAnimationFrame(dibujar);
    if (t - ultimo < (fuerza > 0.5 ? 50 : 110)) return; // ~9 cuadros por segundo (20 en el efecto)
    ultimo = t;
    fase += 1;

    const w = lienzo.width, h = lienzo.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1A1A1A';
    const columnas = Math.floor(w / (tam + 1));
    const filas = Math.floor(h / (tam + 1));
    // de vez en cuando una banda se corre hacia el lado
    const corte = Math.floor(ruido(fase, 1) * filas);
    const largoCorte = Math.floor(ruido(fase, 2) * 40 * fuerza);
    for (let f = 0; f < filas; f++) {
      const ola = 0.5 + 0.5 * Math.sin(f * 0.045 + fase * 0.12 * fuerza);
      const desplazar = f >= corte && f < corte + largoCorte ? Math.floor(ruido(f, fase) * 3) : 0;
      for (let c = 0; c < columnas; c++) {
        // densidad: más puntos hacia el borde derecho, con bloques que titilan
        const borde = (c + 1) / columnas;
        const bloque = ruido(Math.floor(c / 3), Math.floor(f / 6) + Math.floor(fase / 4)) * fuerza;
        const umbral = 0.04 + 0.62 * borde * borde * ola + bloque * 0.6;
        if (ruido(c + 0.5, f + 0.5) < umbral) {
          ctx.fillRect((c + desplazar) * (tam + 1), f * (tam + 1), tam, tam);
        }
      }
    }
  }
  if (!movimientoReducido) requestAnimationFrame(dibujar);
  else { medir(); fuerza = 0; requestAnimationFrame((t) => { dibujar(t); vivo = false; }); }

  return {
    intensidad(v) { fuerza = v; },
    detener() { vivo = false; ro.disconnect(); },
  };
}
