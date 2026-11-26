/* =====================================================================
   main.js — interacciones del sitio
   1. Header: invierte el color del texto y marca la sección visible.
   2. Carrusel de vinilos: pila fija; cada vinilo solo se saca hacia el lado
      (hover en desktop, toque en mobile).
   3. Fondo de la portada en píxeles: el cursor revela la foto celda por
      celda, el borde se rompe en píxeles en una zona de quiebre y al
      bajar el quiebre sube hasta dejar la foto.
   4. Cursor "bounding box" con el nombre de lo que apunta y sus coordenadas.
   5. Sistema de píxeles: bordes que se rompen bajo las huinchas y fotos
      de proyecto que aparecen en píxeles.
   6. Videos de proyecto: aviso "video pendiente" si aún no existe el archivo.
   7. Text Scramble (Motion Primitives, MIT) en el logo y los nombres de proyectos.
   ===================================================================== */

// true en pantallas táctiles (sin mouse): ahí se usan toques en vez de hover
const esTactil = window.matchMedia('(hover: none)').matches;

// true si hay un mouse o trackpad (la pintura del fondo y el cursor solo existen ahí)
const hayMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Si la persona pidió "reducir movimiento" en su sistema, se marca la página
// (el CSS usa .movimiento-reducido, por ejemplo para frenar la huincha)
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('movimiento-reducido');
}

// Convierte píxeles a rem (1rem = 16 px) para escribir las medidas en rem
const aRem = (px) => `${px / 16}rem`;


/* ---------------------------------------------------------------------
   1. HEADER
   --------------------------------------------------------------------- */
const header = document.querySelector('.header');
const portada = document.querySelector('.portada');
const enlacesSeccion = [...document.querySelectorAll('.nav__enlace[href^="#"]')];

function actualizarHeader() {
  if (!header || !portada) return;

  // Altura de la línea del menú: cuando la portada azul ya pasó por debajo,
  // el texto del header cambia a azul (clase header--claro)
  const lineaMenu = header.offsetHeight * 0.75;
  header.classList.toggle('header--claro', portada.getBoundingClientRect().bottom < lineaMenu);

  // Marca con el punto la sección que ocupa la parte de arriba de la pantalla
  const limite = window.innerHeight * 0.4;
  enlacesSeccion.forEach((enlace) => {
    const seccion = document.querySelector(enlace.getAttribute('href'));
    const caja = seccion.getBoundingClientRect();
    enlace.classList.toggle('nav__enlace--activo', caja.top <= limite && caja.bottom > limite);
  });
}

window.addEventListener('scroll', actualizarHeader, { passive: true });
window.addEventListener('resize', actualizarHeader);
actualizarHeader();


/* ---------------------------------------------------------------------
   2. CARRUSEL DE VINILOS
   La pila es fija: el orden no cambia y no se desliza.
   Lo único que se puede hacer es sacar un vinilo hacia el lado:
   - Desktop: al pasar el mouse sale (lo hace el CSS con :hover) y al
     sacar el mouse vuelve a su lugar. Un clic abre el proyecto.
   - Mobile: el primer toque saca el vinilo; un segundo toque en el mismo
     abre el proyecto. Tocar fuera de la pila lo guarda.
   El nombre del proyecto solo se ve mientras su vinilo está afuera.
   --------------------------------------------------------------------- */
const pila = document.querySelector('.pila');

if (pila) {
  const vinilos = [...pila.querySelectorAll('.vinilo')];

  // Centra la diagonal según la cantidad de vinilos y fija el lugar de cada uno
  pila.style.setProperty('--centro', (vinilos.length - 1) / 2);
  vinilos.forEach((vinilo, i) => vinilo.style.setProperty('--i', i));

  // Saca un vinilo (o ninguno, con null) y guarda los demás
  function sacar(vinilo) {
    vinilos.forEach((v) => v.classList.toggle('vinilo--afuera', v === vinilo));
  }

  if (esTactil) {
    vinilos.forEach((vinilo) => {
      vinilo.querySelector('a').addEventListener('click', (evento) => {
        if (!vinilo.classList.contains('vinilo--afuera')) {
          evento.preventDefault();
          sacar(vinilo);
        }
      });
    });

    // Tocar cualquier otra parte de la página guarda el vinilo
    document.addEventListener('click', (evento) => {
      if (!evento.target.closest('.vinilo')) sacar(null);
    });
  }
}


// Funciones que dicen qué hay en el fondo bajo un punto de la página
// (0 = crema, 1 = azul, 2 = foto). Las agregan las secciones 3 y 5 y las usa
// el cursor para ponerse crema sobre lo oscuro
const fondosDePixeles = [];
function fondoEnPunto(x, y) {
  for (const consultar of fondosDePixeles) {
    const fondo = consultar(x, y);
    if (fondo) return fondo;
  }
  return 0;
}

/* ---------------------------------------------------------------------
   3. FONDO DE LA PORTADA Y ZONA DE QUIEBRE (solo inicio)
   El canvas .fondo-pintura cubre el header, la portada y la zona de quiebre
   (.quiebre, el espacio entre la portada y proyectos). Todo se dibuja sobre
   una cuadrícula invisible de celdas cuadradas, del mismo tamaño que la caja
   del cursor (26 px; 16 px en pantallas táctiles). Cada celda puede ser:
   azul, un pedacito de la foto (img/fondo-portada.jpg) o vacía.
   - Portada: azul entero. Donde pasa el cursor la foto se revela celda
     por celda (como píxeles) y después cada celda vuelve al azul.
   - Zona de quiebre: el azul se rompe en cuadraditos hacia abajo, con
     pedacitos de la foto que aparecen y titilan. La foto en sí no se
     deforma: siempre se ve en su lugar.
     El cursor también la rompe.
   - Scroll: al bajar, el quiebre sube y se "come" la portada desde el
     borde, hasta dejar la foto. Así la bajada a proyectos es continua
     (en el teléfono funciona igual, con el dedo).
   --------------------------------------------------------------------- */
const lienzo = document.querySelector('.fondo-pintura');
const quiebre = document.querySelector('.quiebre');

if (lienzo && portada) {
  const CELDA = esTactil ? 16 : 26;      // px de cada celda (26 = caja del cursor)
  const VIDA_MIN = 2200;                 // ms mínimos que una celda revelada se queda abierta
  const VIDA_EXTRA = 1800;               // ms extra al azar (así se cierran a destiempo)
  const RITMO = 70;                      // ms entre cuadros del titileo (se siente "digital")
  const ALCANCE_SCROLL = 1.25;           // cuánto sube el quiebre al bajar por la portada
  const quieto = document.documentElement.classList.contains('movimiento-reducido');

  const pincel = lienzo.getContext('2d');
  const estilos = getComputedStyle(document.documentElement);
  const AZUL = estilos.getPropertyValue('--azul').trim();
  const CREMA = estilos.getPropertyValue('--crema').trim();

  // La foto se carga aparte y se prepara "recortada" al tamaño del canvas
  const foto = new Image();
  foto.src = lienzo.dataset.foto;
  const fotoCubierta = document.createElement('canvas');
  let fotoLista = false;

  // Medidas (en px de pantalla) y cuadrícula
  let k = 1;                 // densidad de píxeles (pantallas retina)
  let ancho = 0;
  let finPortada = 0;        // dónde termina la portada (desde arriba de la página)
  let altoTotal = 0;         // header + portada + zona de quiebre
  let columnas = 0;
  let filas = 0;
  let filasZona = 1;

  // Celdas reveladas por el cursor: número de celda → hasta cuándo sigue abierta
  const reveladas = new Map();

  // Número al azar pero siempre igual para los mismos (x, y): da celdas "estables"
  const ruido = (x, y) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  function medir() {
    k = Math.min(window.devicePixelRatio || 1, 1.5);
    ancho = lienzo.clientWidth;
    finPortada = portada.getBoundingClientRect().bottom + window.scrollY;
    altoTotal = quiebre ? quiebre.getBoundingClientRect().bottom + window.scrollY : finPortada;

    lienzo.style.setProperty('--alto-fondo', aRem(altoTotal));
    lienzo.width = Math.ceil(ancho * k);
    lienzo.height = Math.ceil(altoTotal * k);

    columnas = Math.ceil(ancho / CELDA);
    filas = Math.ceil(altoTotal / CELDA);
    filasZona = Math.max(1, (altoTotal - finPortada) / CELDA);

    prepararFoto();
    dibujar(performance.now());
  }

  // Dibuja la foto cubriendo todo el canvas sin deformarse (como object-fit: cover)
  function prepararFoto() {
    if (!foto.complete || !foto.naturalWidth) return;
    fotoCubierta.width = lienzo.width;
    fotoCubierta.height = lienzo.height;
    const escala = Math.max(lienzo.width / foto.naturalWidth, lienzo.height / foto.naturalHeight);
    const w = foto.naturalWidth * escala;
    const h = foto.naturalHeight * escala;
    fotoCubierta.getContext('2d').drawImage(foto, (lienzo.width - w) / 2, (lienzo.height - h) / 2, w, h);
    fotoLista = true;
  }
  foto.addEventListener('load', () => { prepararFoto(); pedirDibujo(); });

  // Forma del quiebre: según la profundidad, ¿la celda (c, f) es
  // 0 = vacía, 1 = azul o 2 = foto? La profundidad es < 0 dentro de la portada
  // y va de 0 a 1 en la zona de quiebre (más hondo = más roto)
  function forma(c, f, t, profundidad) {
    if (profundidad < -0.25) return 1;

    // Cada celda cambia de vez en cuando, a su propio ritmo (titileo del borde)
    const fija = ruido(c, f);
    const turno = quieto ? 0 : Math.floor(t / 150 / (5 + fija * 9) + fija * 13);
    const cambia = ruido(c * 1.7 + f * 3.1, turno);
    const columna = ruido(Math.floor(c / 2), 99);   // borde irregular, en bloques

    const v = profundidad + (columna - 0.5) * 0.3 + (cambia - 0.5) * 0.35;
    if (v < 0.3) return 1;
    if (v < 0.55 && ruido(c + 11, f + 7) < 0.5) return 2;
    if (v < 0.75 && cambia < 0.12) return 1;        // cuadraditos azules sueltos
    if (v < 0.9 && cambia > 0.93) return 2;         // pedacitos de foto sueltos
    return 0;
  }

  // ¿Qué se dibuja en la celda (c, f)? 0 = vacía (crema), 1 = azul, 2 = foto
  function estadoCelda(c, f, t, avance) {
    const n = f * columnas + c;
    const enPortada = (f + 0.5) * CELDA < finPortada;

    // El cursor la abrió hace poco: se ve la foto
    const hasta = reveladas.get(n);
    if (hasta !== undefined) {
      if (hasta > t) return 2;
      reveladas.delete(n);
    }

    const profundidad = ((f + 0.5) * CELDA - finPortada) / (filasZona * CELDA);
    // Al bajar, el quiebre "sube": lo azul se va rompiendo y deja ver la foto
    const subida = avance * ALCANCE_SCROLL * (finPortada / (filasZona * CELDA));

    if (enPortada) {
      // En la portada, lo que se rompe deja ver la foto que hay detrás
      const estado = forma(c, f, t, profundidad + subida);
      return estado === 0 ? 2 : estado;
    }

    // En la zona se mantiene la forma del borde (lo vacío sigue crema),
    // pero su azul también se convierte en foto al bajar. Así no queda
    // una línea azul lisa entre la portada rota y la zona
    if (forma(c, f, t, profundidad) === 0) return 0;
    const estado = forma(c, f, t, profundidad + subida);
    return estado === 0 ? 2 : estado;
  }

  function dibujar(t) {
    // Cuánto se ha bajado por la portada (0 a 1). Elevado a 1.6: empieza
    // suave y se acelera, así el azul no se rompe de golpe al primer scroll
    const avance = Math.min(Math.max(window.scrollY / finPortada, 0), 1) ** 1.6;
    const lado = CELDA * k;

    // Fondo: azul en la portada y crema en la zona de quiebre
    pincel.fillStyle = AZUL;
    pincel.fillRect(0, 0, lienzo.width, Math.round(finPortada * k));
    pincel.fillStyle = CREMA;
    pincel.fillRect(0, Math.round(finPortada * k), lienzo.width, lienzo.height);

    for (let f = 0; f < filas; f++) {
      const y0 = Math.round(f * lado);
      const y1 = Math.round((f + 1) * lado);
      const enPortada = (f + 0.5) * CELDA < finPortada;

      for (let c = 0; c < columnas; c++) {
        const estado = estadoCelda(c, f, t, avance);
        const x0 = Math.round(c * lado);
        const x1 = Math.round((c + 1) * lado);

        // La portada ya está pintada de azul y la zona de crema:
        // solo se dibujan las celdas que cambian
        if (estado === 2 && fotoLista) {
          pincel.drawImage(fotoCubierta, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        } else if (estado !== 0 && !enPortada) {
          // celda azul de la zona (o foto que todavía no carga)
          pincel.fillStyle = AZUL;
          pincel.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }
    }
  }

  // Para el cursor: qué hay en el fondo bajo un punto de la página
  fondosDePixeles.push((x, y) => {
    if (y < 0 || y >= altoTotal || x < 0 || x >= ancho) return 0;
    const avance = Math.min(Math.max(window.scrollY / finPortada, 0), 1) ** 1.6;
    return estadoCelda(Math.floor(x / CELDA), Math.floor(y / CELDA), performance.now(), avance);
  });

  /* --- el cursor (o el dedo) abre celdas --- */

  // Abre la celda bajo el punto y algunas vecinas al azar (borde pixelado)
  function abrir(x, y, ahora) {
    if (y > altoTotal || y < 0) return;
    const c0 = Math.floor(x / CELDA);
    const f0 = Math.floor(y / CELDA);
    for (let df = -2; df <= 2; df++) {
      for (let dc = -2; dc <= 2; dc++) {
        const c = c0 + dc;
        const f = f0 + df;
        if (c < 0 || f < 0 || c >= columnas || f >= filas) continue;
        const lejos = Math.max(Math.abs(dc), Math.abs(df));
        const probabilidad = lejos === 0 ? 1 : lejos === 1 ? 0.55 : 0.15;
        if (Math.random() > probabilidad) continue;
        const vida = (VIDA_MIN + Math.random() * VIDA_EXTRA) * (lejos === 0 ? 1 : 0.7);
        const n = f * columnas + c;
        reveladas.set(n, Math.max(reveladas.get(n) || 0, ahora + vida));
      }
    }
  }

  // Si el mouse se movió rápido, abre también las celdas del camino
  let anterior = null;
  function recorrer(x, y) {
    const ahora = performance.now();
    if (anterior) {
      const pasos = Math.floor(Math.hypot(x - anterior.x, y - anterior.y) / (CELDA * 0.8));
      for (let i = 1; i < pasos; i++) {
        const t = i / pasos;
        abrir(anterior.x + (x - anterior.x) * t, anterior.y + (y - anterior.y) * t, ahora);
      }
    }
    abrir(x, y, ahora);
    anterior = { x, y };
    pedirDibujo();
  }

  let ultimoX = -1;
  let ultimoY = -1;
  document.addEventListener('pointermove', (evento) => {
    if (evento.pointerType !== 'mouse') return;
    ultimoX = evento.clientX;
    ultimoY = evento.clientY;
    recorrer(evento.clientX + window.scrollX, evento.clientY + window.scrollY);
  });
  document.addEventListener('pointerleave', () => { anterior = null; });

  // En el teléfono, un toque abre un manchón de píxeles
  document.addEventListener('pointerdown', (evento) => {
    if (evento.pointerType === 'mouse') return;
    anterior = null;
    recorrer(evento.clientX + window.scrollX, evento.clientY + window.scrollY);
    anterior = null;
  });

  // Al hacer scroll el cursor recorre la página, así que también abre celdas
  window.addEventListener('scroll', () => {
    if (ultimoX >= 0) recorrer(ultimoX + window.scrollX, ultimoY + window.scrollY);
    pedirDibujo();
  }, { passive: true });

  /* --- animación: solo mientras el canvas se ve en pantalla --- */
  let visible = true;
  let pendiente = false;
  let ultimoCuadro = 0;

  function pedirDibujo() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame((t) => {
      pendiente = false;
      dibujar(t);
      ultimoCuadro = t;
    });
  }

  function animar(t) {
    if (!visible) return;
    requestAnimationFrame(animar);
    if (t - ultimoCuadro < RITMO) return;
    ultimoCuadro = t;
    dibujar(t);
  }

  if (!quieto) {
    new IntersectionObserver(([entrada]) => {
      const antes = visible;
      visible = entrada.isIntersecting;
      if (visible && !antes) requestAnimationFrame(animar);
    }).observe(lienzo);
    requestAnimationFrame(animar);
  }

  // Se vuelve a medir cuando terminan de cargar las tipografías y la página,
  // y si cambia el tamaño de la ventana
  medir();
  document.fonts.ready.then(medir);
  window.addEventListener('load', medir);
  window.addEventListener('resize', medir);
}


/* ---------------------------------------------------------------------
   5. SISTEMA DE PÍXELES (todas las páginas)
   Las mismas celdas cuadradas de la portada, usadas en dos piezas:
   - .borde-pixel: canvas bajo una huincha. El azul de la huincha se
     rompe en cuadraditos hacia abajo, titila y el cursor lo "invierte"
     (azul ↔ crema) por un momento.
   - .proyecto__imagenes: la foto del proyecto aparece rompiendo una capa
     azul en píxeles (de abajo hacia arriba) cuando llega a la pantalla.
     Después, el cursor deja un rastro corto de píxeles azules.
   --------------------------------------------------------------------- */
const TAM_PIXEL = esTactil ? 16 : 26;     // mismo tamaño que las celdas de la portada
const RITMO_PIXELES = 70;                 // ms entre cuadros (se siente "digital")
const APARECER = 1800;                    // ms que tarda una foto en aparecer
const piezasPixel = [];
const quietoPixeles = document.documentElement.classList.contains('movimiento-reducido');
const coloresSitio = getComputedStyle(document.documentElement);
const AZUL_SITIO = coloresSitio.getPropertyValue('--azul').trim();
const CREMA_SITIO = coloresSitio.getPropertyValue('--crema').trim();

// Número al azar pero siempre igual para los mismos (x, y)
const azarFijo = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Prepara un canvas para dibujar celdas: mide su caja y su densidad de píxeles
function prepararLienzo(lienzo) {
  const pieza = {
    lienzo,
    ctx: lienzo.getContext('2d'),
    k: 1,
    columnas: 0,
    filas: 0,
    visible: true,
    invertido: lienzo.classList.contains('borde-pixel--arriba'),
  };
  pieza.medir = () => {
    pieza.k = Math.min(window.devicePixelRatio || 1, 1.5);
    lienzo.width = Math.max(1, Math.ceil(lienzo.clientWidth * pieza.k));
    lienzo.height = Math.max(1, Math.ceil(lienzo.clientHeight * pieza.k));
    pieza.columnas = Math.ceil(lienzo.clientWidth / TAM_PIXEL);
    pieza.filas = Math.ceil(lienzo.clientHeight / TAM_PIXEL);
  };
  // Celda (c, f) bajo un punto de la página, o null si está fuera
  pieza.celdaEn = (x, y) => {
    const caja = lienzo.getBoundingClientRect();
    const lx = x - (caja.left + window.scrollX);
    const ly = y - (caja.top + window.scrollY);
    if (lx < 0 || ly < 0 || lx >= caja.width || ly >= caja.height) return null;
    // En el borde del footer el canvas está dado vuelta (CSS): se cuenta desde abajo
    const fila = pieza.invertido ? caja.height - 1 - ly : ly;
    return { c: Math.floor(lx / TAM_PIXEL), f: Math.floor(fila / TAM_PIXEL) };
  };
  // Pinta una celda con bordes exactos (sin rayitas entre celdas)
  pieza.celda = (c, f) => {
    const lado = TAM_PIXEL * pieza.k;
    const x0 = Math.round(c * lado);
    const y0 = Math.round(f * lado);
    pieza.ctx.fillRect(x0, y0, Math.round((c + 1) * lado) - x0, Math.round((f + 1) * lado) - y0);
  };
  return pieza;
}

/* --- borde que se rompe bajo una huincha --- */
function crearBordePixel(lienzo) {
  const pieza = prepararLienzo(lienzo);
  const invertidas = new Map();          // celda → hasta cuándo está invertida

  // Forma del borde: azul arriba (pegado a la huincha) y cada vez más roto hacia abajo
  function forma(c, f, t) {
    if (f === 0) return 1;
    const profundidad = (f + 0.5) / pieza.filas;
    const fija = azarFijo(c, f);
    const turno = quietoPixeles ? 0 : Math.floor(t / 150 / (5 + fija * 9) + fija * 13);
    const cambia = azarFijo(c * 1.7 + f * 3.1, turno);
    const columna = azarFijo(Math.floor(c / 2), 99);
    const v = profundidad + (columna - 0.5) * 0.3 + (cambia - 0.5) * 0.35;
    if (v < 0.35) return 1;
    if (v < 0.8 && cambia < 0.12) return 1;   // cuadraditos sueltos
    return 0;
  }

  function estado(c, f, t) {
    let e = forma(c, f, t);
    const n = f * pieza.columnas + c;
    const hasta = invertidas.get(n);
    if (hasta !== undefined) {
      if (hasta > t) e = 1 - e;
      else invertidas.delete(n);
    }
    return e;
  }

  pieza.dibujar = (t) => {
    const { ctx } = pieza;
    ctx.fillStyle = CREMA_SITIO;
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.fillStyle = AZUL_SITIO;
    for (let f = 0; f < pieza.filas; f++) {
      for (let c = 0; c < pieza.columnas; c++) {
        if (estado(c, f, t) === 1) pieza.celda(c, f);
      }
    }
  };

  // El cursor invierte la celda que toca y algunas vecinas
  pieza.tocar = (x, y, ahora) => {
    const celda = pieza.celdaEn(x, y);
    if (!celda) return;
    for (let df = -1; df <= 1; df++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = celda.c + dc;
        const f = celda.f + df;
        if (c < 0 || f < 1 || c >= pieza.columnas || f >= pieza.filas) continue;
        if ((dc || df) && Math.random() > 0.4) continue;
        const n = f * pieza.columnas + c;
        if (!invertidas.has(n)) invertidas.set(n, ahora + 600 + Math.random() * 800);
      }
    }
  };

  // Para el color del cursor: 1 si bajo el punto hay azul
  pieza.fondoEn = (x, y) => {
    const celda = pieza.celdaEn(x, y);
    return celda ? estado(celda.c, celda.f, performance.now()) : 0;
  };

  return pieza;
}

/* --- foto de proyecto que aparece en píxeles --- */
function crearImagenPixel(figura) {
  const lienzo = document.createElement('canvas');
  lienzo.className = 'imagen-pixel';
  lienzo.setAttribute('aria-hidden', 'true');
  figura.append(lienzo);

  const pieza = prepararLienzo(lienzo);
  const rastro = new Map();              // celda → hasta cuándo queda azul
  let inicio = quietoPixeles ? -Infinity : null;   // cuándo empezó a aparecer

  // ¿La celda sigue tapada? Se destapan al azar, primero las de abajo
  function tapada(c, f, t) {
    if (inicio === null) return true;
    const avance = Math.min((t - inicio) / APARECER, 1);
    const orden = azarFijo(c + 7, f + 3) * 0.55 + (1 - (f + 0.5) / pieza.filas) * 0.45;
    return orden >= avance * 1.05;
  }

  pieza.dibujar = (t) => {
    const { ctx } = pieza;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    ctx.fillStyle = AZUL_SITIO;
    for (let f = 0; f < pieza.filas; f++) {
      for (let c = 0; c < pieza.columnas; c++) {
        const n = f * pieza.columnas + c;
        const hasta = rastro.get(n);
        if (hasta !== undefined && hasta <= t) rastro.delete(n);
        if (tapada(c, f, t) || (hasta !== undefined && hasta > t)) pieza.celda(c, f);
      }
    }
  };

  // Empieza a aparecer cuando al menos un cuarto de la foto está en pantalla
  new IntersectionObserver(([entrada], observador) => {
    if (entrada.intersectionRatio >= 0.25) {
      inicio = performance.now();
      observador.disconnect();
    }
  }, { threshold: [0.25] }).observe(figura);

  // Ya destapada, el cursor deja un rastro corto de píxeles azules
  pieza.tocar = (x, y, ahora) => {
    if (inicio === null || ahora - inicio < APARECER) return;
    const celda = pieza.celdaEn(x, y);
    if (!celda) return;
    const n = celda.f * pieza.columnas + celda.c;
    rastro.set(n, ahora + 350 + Math.random() * 350);
  };

  pieza.fondoEn = (x, y) => (pieza.celdaEn(x, y) ? 2 : 0);   // sobre la foto: cursor crema
  return pieza;
}

/* --- se arman todas las piezas de la página --- */
document.querySelectorAll('.borde-pixel').forEach((lienzo) => piezasPixel.push(crearBordePixel(lienzo)));
document.querySelectorAll('.proyecto__imagenes').forEach((figura) => piezasPixel.push(crearImagenPixel(figura)));

if (piezasPixel.length) {
  piezasPixel.forEach((pieza) => fondosDePixeles.push(pieza.fondoEn));

  const medirTodo = () => piezasPixel.forEach((pieza) => { pieza.medir(); pieza.dibujar(performance.now()); });
  medirTodo();
  document.fonts.ready.then(medirTodo);
  window.addEventListener('load', medirTodo);
  window.addEventListener('resize', medirTodo);

  // Solo se animan las piezas que están en pantalla
  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      const pieza = piezasPixel.find((p) => p.lienzo === entrada.target);
      if (pieza) pieza.visible = entrada.isIntersecting;
    });
  });
  piezasPixel.forEach((pieza) => observador.observe(pieza.lienzo));

  let ultimoPixel = 0;
  function animarPixeles(t) {
    requestAnimationFrame(animarPixeles);
    if (t - ultimoPixel < RITMO_PIXELES) return;
    ultimoPixel = t;
    piezasPixel.forEach((pieza) => { if (pieza.visible) pieza.dibujar(t); });
  }
  requestAnimationFrame(animarPixeles);

  // El mouse (o un toque) afecta a las piezas que tiene debajo
  const tocarTodo = (evento) => {
    const ahora = performance.now();
    const x = evento.clientX + window.scrollX;
    const y = evento.clientY + window.scrollY;
    piezasPixel.forEach((pieza) => pieza.tocar(x, y, ahora));
  };
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') tocarTodo(e); });
  document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') tocarTodo(e); });
}


/* ---------------------------------------------------------------------
   6. VIDEOS DE PROYECTO (imagen ↔ video)
   En reposo se ve la imagen del proyecto. Con el cursor encima cambia al
   video (que corre en loop) y al salir vuelve a la imagen. En el teléfono,
   cada toque cambia entre imagen y video.
   Si el archivo del video no existe, al activarlo se ve el aviso
   "[ video pendiente ]" (clase proyecto__imagenes--pendiente)
   --------------------------------------------------------------------- */
document.querySelectorAll('.proyecto__video').forEach((figura) => {
  const video = figura.querySelector('video');
  if (!video) return;

  // Solo se marca pendiente cuando el navegador de verdad no encontró el archivo
  const marcarPendiente = () => figura.classList.add('proyecto__imagenes--pendiente');
  video.addEventListener('error', marcarPendiente);
  figura.querySelectorAll('source').forEach((fuente) => fuente.addEventListener('error', marcarPendiente));
  video.addEventListener('loadeddata', () => figura.classList.remove('proyecto__imagenes--pendiente'));

  function mostrar(activo) {
    figura.classList.toggle('proyecto__video--activo', activo);
    if (activo) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }

  figura.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') mostrar(true); });
  figura.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') mostrar(false); });
  figura.addEventListener('click', (e) => {
    if (esTactil) mostrar(!figura.classList.contains('proyecto__video--activo'));
  });
});


/* ---------------------------------------------------------------------
   7. TEXT SCRAMBLE (logo y nombres de proyectos)
   Componente adaptado a JavaScript sin React desde "Text Scramble" de
   Motion Primitives (https://motion-primitives.com/docs/text-scramble),
   de Julien Thibeaut (ibelick), licencia MIT.
   Las letras se desordenan en caracteres al azar y se van ordenando de
   izquierda a derecha, como píxeles que cargan.
   Se usa solo al cargar la página, en el logo y en el nombre de cada
   página de proyecto (con el mouse no se activa: ya se mueven los píxeles).
   --------------------------------------------------------------------- */
const CARACTERES_SCRAMBLE = 'abcdefghijklmnopqrstuvwxyz0123456789+#_/';

function revolverTexto(elemento, { duracion = 800, velocidad = 40 } = {}) {
  if (!elemento || document.documentElement.classList.contains('movimiento-reducido')) return;

  // Se guarda el texto real una sola vez (y queda para lectores de pantalla)
  if (!elemento.dataset.textoOriginal) elemento.dataset.textoOriginal = elemento.textContent;
  const original = elemento.dataset.textoOriginal;
  const pasos = duracion / velocidad;
  let paso = 0;

  clearInterval(elemento._scramble);
  elemento._scramble = setInterval(() => {
    const avance = paso / pasos;
    let texto = '';
    for (let i = 0; i < original.length; i++) {
      const letra = original[i];
      // Los espacios se respetan; las letras ya "cargadas" quedan fijas
      if (letra === ' ' || avance * original.length > i) texto += letra;
      else texto += CARACTERES_SCRAMBLE[Math.floor(Math.random() * CARACTERES_SCRAMBLE.length)];
    }
    elemento.textContent = texto;
    paso++;
    if (paso > pasos) {
      clearInterval(elemento._scramble);
      elemento.textContent = original;
    }
  }, velocidad);
}

// Logo: al cargar, cuando ya está la tipografía. "pañitrur" termina un poco después
document.fonts.ready.then(() => {
  document.querySelectorAll('.logo__linea').forEach((linea, i) => revolverTexto(linea, { duracion: 900 + i * 250 }));
});

// Nombre de la página de proyecto: al cargar. El aria-label deja el nombre
// real para lectores de pantalla mientras las letras cambian
document.querySelectorAll('.proyecto__nombre').forEach((nombre) => {
  nombre.setAttribute('aria-label', nombre.textContent);
  document.fonts.ready.then(() => revolverTexto(nombre, { duracion: 900 }));
});


/* ---------------------------------------------------------------------
   4. CURSOR "BOUNDING BOX" (solo con mouse)
   Muestra "ID 00 · nombre" de lo que apunta y las coordenadas X / Y en vivo.
   El número sale del data-id de la sección y el nombre del data-cursor
   (o del texto del enlace).
   --------------------------------------------------------------------- */
if (hayMouse) {
  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML =
    '<span class="cursor__id"></span>' +
    '<span class="cursor__caja"></span>' +
    '<span class="cursor__coordenadas"></span>';
  document.body.append(cursor);
  document.documentElement.classList.add('con-cursor');

  const textoId = cursor.querySelector('.cursor__id');
  const caja = cursor.querySelector('.cursor__caja');
  const textoCoordenadas = cursor.querySelector('.cursor__coordenadas');

  let mouseX = -100;
  let mouseY = -100;

  // Rellena con ceros a la izquierda: 42 → "0042"
  const cuatroCifras = (n) => String(Math.max(0, Math.round(n))).padStart(4, '0');

  // Mueve el cursor para que el centro de la caja quede justo en la punta del mouse.
  // El cursor vive al final de la página, así que se calcula desde su lugar original
  function ubicarCursor() {
    // Medidas dentro del cursor: dónde está el centro de la caja y cuánto mide en total
    const marco = cursor.getBoundingClientRect();
    const marcoCaja = caja.getBoundingClientRect();
    const centroX = marcoCaja.left - marco.left + marcoCaja.width / 2;
    const centroY = marcoCaja.top - marco.top + marcoCaja.height / 2;
    const altoCursor = textoCoordenadas.getBoundingClientRect().bottom - marco.top;

    let x = mouseX + window.scrollX - centroX;
    let y = mouseY + window.scrollY - centroY;

    // Evita que el cursor alargue la página por abajo
    y = Math.min(y, document.body.offsetHeight - altoCursor);

    cursor.style.transform = `translate(${aRem(x)}, ${aRem(y - cursor.offsetTop)})`;
    textoCoordenadas.textContent = `X ${cuatroCifras(mouseX)} Y ${cuatroCifras(mouseY)}`;
  }

  // Elementos oscuros de la página sobre los que el cursor pasa a crema
  const FONDOS_OSCUROS = '.huincha, .vinilo__portada, .proyecto__imagenes, .camara__imagen, .pie__contenido';

  // Si bajo el mouse hay azul o foto (en el canvas o en un elemento oscuro),
  // el cursor pasa a crema para que se siga viendo
  function actualizarColor(objetivo) {
    const sobreOscuro = objetivo instanceof Element && objetivo.closest(FONDOS_OSCUROS);
    const fondo = fondoEnPunto(mouseX + window.scrollX, mouseY + window.scrollY);
    cursor.classList.toggle('cursor--claro', Boolean(sobreOscuro) || fondo !== 0);
  }

  // Escribe el número de la sección y el nombre de lo que está bajo el mouse
  function actualizarEtiqueta(objetivo) {
    actualizarColor(objetivo);
    if (!(objetivo instanceof Element)) return;
    const seccion = objetivo.closest('[data-id]');
    const elemento = objetivo.closest('[data-cursor], a, button');
    const numero = seccion ? seccion.dataset.id : '00';
    let nombre = '';
    if (elemento) {
      nombre = elemento.dataset.cursor || elemento.textContent.trim();
    }
    textoId.textContent = `ID ${numero} · ${nombre.toLowerCase()}`;
  }

  document.addEventListener('pointermove', (evento) => {
    mouseX = evento.clientX;
    mouseY = evento.clientY;
    cursor.classList.add('cursor--visible');
    actualizarEtiqueta(evento.target);
    ubicarCursor();
  });

  // Al hacer scroll sin mover el mouse, el cursor sigue en el mismo lugar de la pantalla
  window.addEventListener('scroll', () => {
    ubicarCursor();
    actualizarEtiqueta(document.elementFromPoint(mouseX, mouseY));
  }, { passive: true });

  // Se esconde cuando el mouse sale de la ventana y vuelve al entrar
  document.documentElement.addEventListener('mouseleave', () => cursor.classList.remove('cursor--visible'));
  document.documentElement.addEventListener('mouseenter', () => cursor.classList.add('cursor--visible'));
}
