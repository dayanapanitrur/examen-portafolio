/* =====================================================================
   mano-cromada.js — mano 3D de metal líquido (cromo) para "¿interactuemos?"
   ---------------------------------------------------------------------
   No usa archivos 3D: la mano se dibuja con un shader de WebGL2 por
   "raymarching". Cada parte (palma, falanges, antebrazo, gotas) es una
   forma matemática y se funden entre sí con uniones suaves; por eso se ve
   como metal líquido.

   Uso:
     import { crearManoCromada } from '../modelos-3d/mano-cromada.js';
     const mano = crearManoCromada(document.querySelector('#mano'));
     mano.setPulso(true);          // pulso suave (mobile: "tócame")
     mano.setSeguir(0.4, 0.5);     // se inclina hacia la mano de la cámara (0–1)
     await mano.disolver();        // se deshace en píxeles / glitch
     mano.destruir();

   Paso 1: la mano se dibuja en una textura (a menor resolución).
   Paso 2: esa textura pasa a la pantalla con los destellos de estrella y,
           al final, con el efecto de disolución en píxeles.
   ===================================================================== */

/* ---------------- shaders ---------------- */

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/* Paso 1: la mano */
const FRAG_MANO = /* glsl */ `#version 300 es
precision highp float;
out vec4 color;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uJ[20];      // articulaciones: 5 dedos × 4 puntos
uniform float uR[20];      // radio en cada articulación
uniform mat3  uRot;        // giro del objeto (inverso)
uniform vec3  uOff;        // flotación
uniform float uScale;      // pulso
uniform float uGlow;       // brillo extra del pulso
uniform float uRebote;     // 1 = reflejos entre dedos (calidad alta)

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
// Cono redondeado (falange que se adelgaza): Inigo Quilez
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// Pliegue (surco fino) a lo largo de una curva: 1 en el surco, 0 lejos
float surco(float dist, float ancho) { return exp(-dist * dist / (ancho * ancho)); }

float mapa(vec3 pMundo) {
  vec3 q = uRot * (pMundo - uOff) / uScale;

  // Caja que envuelve toda la mano: lejos de ella no se calcula el detalle
  float dCaja = sdCapsule(q, vec3(0.0, -3.1, 0.0), vec3(0.0, 1.5, 0.0), 0.95);
  if (dCaja > 0.25) return dCaja * uScale;

  /* --- palma: ahuecada, más angosta hacia la muñeca --- */
  vec3 pp = q - vec3(0.0, 0.02, 0.0);
  pp.z += 0.20 * pp.x * pp.x - 0.025;
  float ancho = mix(0.25, 0.30, smoothstep(-0.46, 0.25, pp.y));
  float d = sdRoundBox(pp, vec3(ancho, 0.34, 0.012), 0.115);
  d = smin(d, sdEllipsoid(q - vec3(-0.23, -0.17, 0.08), vec3(0.22, 0.29, 0.13)), 0.14); // base del pulgar
  d = smin(d, sdEllipsoid(q - vec3(0.26, -0.13, 0.045), vec3(0.13, 0.29, 0.09)), 0.10);   // borde del meñique
  d = smin(d, sdEllipsoid(q - vec3(0.0, 0.33, 0.06), vec3(0.36, 0.10, 0.07)), 0.08);     // almohadillas bajo los dedos

  /* --- líneas de la palma (solo por delante) --- */
  float frente = smoothstep(0.02, 0.1, pp.z);
  float lineas = 0.0;
  lineas += surco(pp.y - (0.17 + 0.07 * pp.x - 0.35 * pp.x * pp.x), 0.016) * smoothstep(0.38, 0.25, abs(pp.x - 0.04));
  lineas += surco(pp.y - (0.04 - 0.18 * pp.x - 0.2 * pp.x * pp.x), 0.016) * smoothstep(0.34, 0.2, abs(pp.x + 0.02));
  lineas += surco(length((pp.xy - vec2(-0.45, -0.24)) * vec2(1.0, 0.72)) - 0.29, 0.018) * smoothstep(-0.44, -0.3, pp.y);
  d += 0.006 * lineas * frente;

  /* --- dedos: 3 falanges cada uno, con pliegues en los nudillos --- */
  vec3 qd = vec3(q.xy, q.z * 1.12); // dedos un poco aplanados
  for (int i = 0; i < 5; i++) {
    int b = i * 4;
    float dedo = sdRoundCone(qd, uJ[b] * vec3(1, 1, 1.12), uJ[b + 1] * vec3(1, 1, 1.12), uR[b], uR[b + 1]);
    dedo = smin(dedo, sdRoundCone(qd, uJ[b + 1] * vec3(1, 1, 1.12), uJ[b + 2] * vec3(1, 1, 1.12), uR[b + 1], uR[b + 2]), 0.06);
    dedo = smin(dedo, sdRoundCone(qd, uJ[b + 2] * vec3(1, 1, 1.12), uJ[b + 3] * vec3(1, 1, 1.12), uR[b + 2], uR[b + 3]), 0.05);
    dedo /= 1.12;

    // pliegues en las articulaciones del medio y de la punta
    float pliegue = 0.0;
    for (int j = 1; j < 3; j++) {
      vec3 eje = normalize(uJ[b + j + 1] - uJ[b + j]);
      vec3 rel = q - uJ[b + j];
      float axial = dot(rel, eje);
      pliegue += surco(axial, 0.014) * step(0.0, rel.z) * step(length(rel - eje * axial), uR[b + j] * 1.5);
    }
    dedo += 0.0045 * pliegue;

    d = smin(d, dedo, i == 0 ? 0.17 : 0.08);
  }

  /* --- muñeca y antebrazo (sección ovalada) --- */
  vec3 pa = vec3(q.x, q.y, q.z * 1.3);
  float brazo = sdRoundCone(pa, vec3(0.0, -0.42, 0.0), vec3(0.0, -1.5, 0.0), 0.285, 0.255) * 0.78;
  d = smin(d, brazo, 0.2);

  /* --- el antebrazo se derrite: chorreados y gotas --- */
  if (q.y < -1.1) {
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float h = hash1(fi + 3.0);
      float ang = -1.25 + fi * 0.5 + (h - 0.5) * 0.2;
      vec3 arriba = vec3(sin(ang) * 0.17, -1.66, cos(ang) * 0.13);
      float largo = 0.12 + 0.42 * h + 0.08 * sin(uTime * 0.55 + fi * 1.7);
      vec3 punta = arriba - vec3(0.0, largo, 0.0);
      float chorro = sdRoundCone(q, arriba, punta, 0.06, 0.026);
      chorro = smin(chorro, length(q - punta - vec3(0.0, -0.02, 0.0)) - 0.045, 0.05);
      d = smin(d, chorro, 0.1);

      // una gota que se suelta y cae, cada tanto
      if (i % 2 == 0) {
        float fase = fract(uTime * 0.18 + h);
        vec3 c = punta - vec3(0.0, 0.06 + fase * fase * 1.4, 0.0);
        float gota = sdEllipsoid(q - c, vec3(0.042, 0.052, 0.042) * (1.0 - fase * 0.35));
        d = smin(d, gota, 0.09 * (1.0 - smoothstep(0.0, 0.25, fase)) + 0.001);
      }
    }
  }

  /* --- superficie líquida: ondula apenas, más en la zona que se derrite --- */
  float amp = 0.004 + 0.010 * smoothstep(-0.7, -1.6, q.y);
  d += amp * sin(q.x * 13.0 + uTime * 0.9) * sin(q.y * 11.0 - uTime * 1.2) * sin(q.z * 12.0 + uTime * 0.7);

  return d * 0.9 * uScale;
}

vec3 normal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * mapa(p + k.xyy * e) + k.yyx * mapa(p + k.yyx * e) +
                   k.yxy * mapa(p + k.yxy * e) + k.xxx * mapa(p + k.xxx * e));
}

float oclusion(vec3 p, vec3 n) {
  float o = 0.0, peso = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.02 + 0.07 * float(i);
    o += (h - mapa(p + n * h)) * peso;
    peso *= 0.7;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}

// Caja de luz rectangular en el "estudio" (para los reflejos largos del cromo)
float cajaLuz(vec3 r, float azim, float elev, vec2 tam, float borde) {
  float a = atan(r.x, r.z);
  float e = asin(clamp(r.y, -1.0, 1.0));
  vec2 dd = abs(vec2(a - azim, e - elev)) - tam;
  return 1.0 - smoothstep(0.0, borde, max(dd.x, dd.y));
}

// Lo que refleja el cromo: estudio oscuro con cielo claro y cajas de luz
vec3 entorno(vec3 r) {
  float h = r.y;
  vec3 c = vec3(0.008, 0.01, 0.014);                                  // estudio casi negro
  c += vec3(0.95, 0.96, 0.98) * smoothstep(0.3, 0.85, h);             // cielo claro solo muy arriba
  c += vec3(0.16, 0.17, 0.19) * smoothstep(-0.15, -0.8, h);           // piso gris oscuro
  c *= 1.0 - 0.7 * exp(-pow((h + 0.1 + 0.22 * r.x) / 0.035, 2.0));    // horizonte oscuro, inclinado
  c += vec3(0.22, 0.30, 0.42) * smoothstep(-0.05, 0.12, h) * smoothstep(0.32, 0.12, h) * 0.45; // franja azulada
  c += 3.2 * cajaLuz(r,  1.30, 0.15, vec2(0.07, 0.80), 0.05);         // tira vertical derecha
  c += 2.6 * cajaLuz(r, -1.50, 0.10, vec2(0.05, 0.75), 0.04);         // tira vertical izquierda
  c += 1.6 * cajaLuz(r,  0.45, 0.10, vec2(0.03, 0.55), 0.03);         // tira fina frontal
  c += 2.0 * cajaLuz(r,  0.25, 0.95, vec2(0.60, 0.10), 0.10);         // luz cenital
  c += 1.2 * cajaLuz(r, -0.6, -0.28, vec2(0.55, 0.025), 0.03);        // línea horizontal baja
  c += 0.9 * cajaLuz(r,  2.80, 0.30, vec2(0.25, 0.30), 0.15);         // rebote trasero
  c += vec3(1.0, 0.99, 0.96) * 0.22 * smoothstep(0.3, 1.0, -r.z) * smoothstep(-0.2, 0.3, h); // el crema de la página
  return c;
}

vec3 sombrearCromo(vec3 p, vec3 rd) {
  vec3 n = normal(p);
  vec3 v = -rd;
  vec3 r = reflect(rd, n);
  float nv = clamp(dot(n, v), 0.0, 1.0);
  vec3 F = mix(vec3(0.72, 0.74, 0.78), vec3(1.0), pow(1.0 - nv, 5.0));

  vec3 refl = entorno(r);

  // segundo rebote: lo que refleja un dedo de los otros dedos
  if (uRebote > 0.5) {
    float t = 0.03;
    for (int i = 0; i < 36; i++) {
      float dd = mapa(p + n * 0.01 + r * t);
      if (dd < 0.002) {
        vec3 p2 = p + n * 0.01 + r * t;
        vec3 n2 = normal(p2);
        refl = entorno(reflect(r, n2)) * 0.62;
        break;
      }
      t += dd;
      if (t > 3.0) break;
    }
  }

  vec3 c = refl * F;
  c *= mix(0.25, 1.0, oclusion(p, n));

  // destellos puntuales muy finos (luego el paso 2 les dibuja la estrella)
  c += 7.0 * pow(max(dot(r, normalize(vec3(0.55, 0.65, 0.55))), 0.0), 1400.0);
  c += 5.0 * pow(max(dot(r, normalize(vec3(-0.6, 0.25, 0.75))), 0.0), 1800.0);
  c += 4.0 * pow(max(dot(r, normalize(vec3(0.15, -0.35, 1.0))), 0.0), 2200.0);

  c += uGlow * vec3(0.12, 0.14, 0.2);
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, -0.2, 7.6);
  float foco = 0.5 / tan(radians(14.0));
  vec3 rd = normalize(vec3(uv, -foco));
  float tamPixel = 1.0 / (uRes.y * foco);

  float t = 5.0;              // la mano está cerca de z = 0: se parte cerca
  float mejor = 1e9, tMejor = t;
  bool toco = false;
  for (int i = 0; i < 110; i++) {
    float d = mapa(ro + rd * t);
    float rel = d / (t * tamPixel);
    if (rel < mejor) { mejor = rel; tMejor = t; }
    if (d < 0.0008 * t) { toco = true; break; }
    t += d;
    if (t > 10.5) break;
  }

  // borde suave (antialias): los rayos que pasan rozando dan transparencia parcial
  float alfa = toco ? 1.0 : 1.0 - smoothstep(0.0, 1.6, mejor);
  if (alfa <= 0.0) { color = vec4(0.0); return; }

  vec3 c = sombrearCromo(ro + rd * (toco ? t : tMejor), rd);
  c = 1.0 - exp(-c * 1.15);           // tono suave
  c = pow(c, vec3(1.0 / 2.2));
  color = vec4(c * alfa, alfa);       // alfa premultiplicado
}`;

/* Paso 2: destellos + disolución en píxeles */
const FRAG_POST = /* glsl */ `#version 300 es
precision highp float;
out vec4 color;

uniform sampler2D uTex;
uniform vec2  uRes;       // tamaño del canvas en px
uniform float uTime;
uniform float uDis;       // 0 = mano entera, 1 = disuelta
uniform float uDestellos; // 1 = dibujar estrellas

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

vec4 muestra(vec2 px) { return texture(uTex, clamp(px / uRes, 0.0, 1.0)); }

float brillo(vec2 px) {
  vec4 c = muestra(px);
  return smoothstep(0.9, 1.0, max(c.r, max(c.g, c.b)) / max(c.a, 0.001)) * c.a;
}

// Paleta del glitch (referencia): pizarra, cian, celeste pálido y un oliva
vec3 paleta(float l, float r) {
  vec3 oscuro = vec3(0.16, 0.22, 0.25);
  vec3 cian   = vec3(0.33, 0.62, 0.65);
  vec3 claro  = vec3(0.82, 0.94, 0.95);
  vec3 c = l < 0.5 ? mix(oscuro, cian, l * 2.0) : mix(cian, claro, (l - 0.5) * 2.0);
  return r > 0.9 ? mix(c, vec3(0.42, 0.36, 0.16), 0.75) : c;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  float d = uDis;

  if (d <= 0.0) {
    vec4 c = muestra(px);
    // estrellas: rayos en cruz que salen de los puntos más brillantes
    if (uDestellos > 0.5) {
      float s = 0.0;
      vec2 ej1 = vec2(cos(0.18), sin(0.18));
      vec2 ej2 = vec2(-ej1.y, ej1.x);
      float paso = uRes.y / 420.0;
      for (int k = 1; k <= 12; k++) {
        float w = pow(1.0 - float(k) / 13.0, 2.2);
        float o = float(k) * paso * 1.6;
        s += (brillo(px + ej1 * o) + brillo(px - ej1 * o)) * w;
        s += (brillo(px + ej2 * o) + brillo(px - ej2 * o)) * w * 0.8;
      }
      float titileo = 0.75 + 0.25 * sin(uTime * 2.3);
      s *= 0.32 * titileo;
      c.rgb += vec3(s);
      c.a = max(c.a, clamp(s, 0.0, 1.0));
    }
    color = c;
    return;
  }

  /* --- disolución --- */
  // 1) cortes horizontales que saltan (glitch) al principio
  float alto = uRes.y * 0.025;
  float franja = floor(px.y / alto);
  float salto = step(0.72, hash(vec2(franja, floor(uTime * 18.0))));
  float fuerzaSalto = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.35, 0.6, d));
  px.x += (hash(vec2(franja * 3.1, floor(uTime * 24.0))) - 0.5) * uRes.x * 0.09 * salto * fuerzaSalto;

  // 2) pixelado en bloques que crecen
  float bloque = max(1.0, floor(mix(1.0, uRes.x * 0.04, smoothstep(0.04, 0.4, d))));
  vec2 celda = floor(px / bloque);
  vec2 centro = (celda + 0.5) * bloque;
  float rc = hash(celda);

  // 3) los bloques se apagan de arriba hacia abajo, con azar
  float yN = px.y / uRes.y;                // 1 = arriba
  float umbral = d * 1.7 - (1.0 - yN) * 0.7;
  float queda = step(umbral, rc);
  vec4 base = muestra(centro);
  // separación de color (RGB) en los primeros instantes
  float sep = fuerzaSalto * bloque * 0.6 + fuerzaSalto * 4.0;
  base.r = muestra(centro + vec2(sep, 0.0)).r;
  base.b = muestra(centro - vec2(sep, 0.0)).b;
  base *= queda;

  // 4) chorreado vertical: columnas que arrastran el color hacia abajo
  float anchoCol = max(2.0, bloque * (0.35 + 0.65 * hash1(floor(px.x / 7.0))));
  float col = floor(px.x / anchoCol);
  float hc = hash1(col + 0.37);
  float caida = smoothstep(0.2, 0.95, d) * (0.15 + 0.85 * hc) * uRes.y * 0.75 * step(0.3, hc);
  vec4 chorro = vec4(0.0);
  float xc = (col + 0.5) * anchoCol;
  for (int k = 0; k < 6; k++) {
    float f = (float(k) + hash1(col + float(k))) / 6.0;
    chorro += muestra(vec2(xc, px.y + caida * f));
  }
  chorro /= 6.0;
  chorro *= step(0.12, chorro.a) * (0.6 + 0.4 * hc);

  vec4 c = max(base, chorro * smoothstep(0.15, 0.4, d));

  // 5) los colores pasan a la paleta del glitch
  float lum = dot(c.rgb / max(c.a, 0.001), vec3(0.3, 0.55, 0.15));
  vec3 g = paleta(lum, hash(celda + 7.0));
  c.rgb = mix(c.rgb, g * c.a, smoothstep(0.08, 0.45, d));

  // 6) bloques sueltos que aparecen alrededor (ruido de datos)
  vec2 celdaR = floor(px / (bloque * 0.9 + 3.0));
  float ruido = step(0.986, hash(celdaR + floor(uTime * 9.0)));
  ruido *= smoothstep(0.15, 0.45, d) * (1.0 - smoothstep(0.7, 0.95, d));
  ruido *= smoothstep(0.0, 0.25, abs(px.x / uRes.x - 0.5) < 0.42 ? 1.0 : 0.0);
  c = mix(c, vec4(vec3(0.16, 0.22, 0.25), 1.0), ruido);

  // 7) todo se apaga al final, columna por columna
  float fin = smoothstep(0.62 + hc * 0.2, 0.86 + hc * 0.14, d);
  c *= 1.0 - fin;

  color = c;
}`;

/* ---------------- matemáticas pequeñas ---------------- */

const normalizar = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sumar = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

// Gira el vector v alrededor del eje (unitario) en el ángulo dado (Rodrigues)
function girar(v, eje, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const k = cruz(eje, v);
  const d = eje[0] * v[0] + eje[1] * v[1] + eje[2] * v[2];
  return [
    v[0] * c + k[0] * s + eje[0] * d * (1 - c),
    v[1] * c + k[1] * s + eje[1] * d * (1 - c),
    v[2] * c + k[2] * s + eje[2] * d * (1 - c),
  ];
}

// Matriz 3×3 (por columnas) de los giros X, Y, Z ya invertida (traspuesta)
function matrizGiroInversa(x, y, z) {
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx
  const r = [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy,     cy * sx,                cy * cx,
  ];
  // WebGL lee por columnas: pasar R por filas equivale a pasar su traspuesta (= inversa)
  return new Float32Array(r);
}

/* ---------------- la mano: medidas y "respiración" ---------------- */

// El pulgar queda a la izquierda (como en el boceto). Unidades: la palma mide ~0.8 de ancho
const DEDOS = [
  // pulgar
  { base: [-0.30, -0.22, 0.10], dir: [-0.80, 0.54, 0.26], L: [0.36, 0.30, 0.25], R: [0.140, 0.121, 0.105, 0.087], curva: [0.10, 0.16, 0.12], fase: 0.0, pulgar: true },
  // índice, medio, anular, meñique
  { base: [-0.29, 0.40, 0.0], abre: 0.17,  L: [0.44, 0.26, 0.21], R: [0.108, 0.094, 0.083, 0.069], curva: [0.10, 0.14, 0.10], fase: 0.6 },
  { base: [-0.095, 0.44, 0.0], abre: 0.04, L: [0.48, 0.30, 0.23], R: [0.112, 0.099, 0.086, 0.072], curva: [0.08, 0.12, 0.09], fase: 1.1 },
  { base: [0.11, 0.42, 0.0], abre: -0.10,  L: [0.45, 0.28, 0.22], R: [0.106, 0.094, 0.082, 0.068], curva: [0.10, 0.14, 0.10], fase: 1.7 },
  { base: [0.29, 0.34, 0.0], abre: -0.28,  L: [0.35, 0.21, 0.19], R: [0.092, 0.081, 0.071, 0.059], curva: [0.14, 0.17, 0.12], fase: 2.3 },
];

/**
 * Calcula las 20 articulaciones para el instante t.
 * La mano está abierta; "respira" cerrando y abriendo apenas los dedos.
 */
function articulaciones(t, amplitud, J, R) {
  const ritmo = 1.05; // un ciclo cada ~6 s
  DEDOS.forEach((dedo, i) => {
    const ola = 0.5 + 0.5 * Math.sin(t * ritmo - dedo.fase * 0.55);
    // pequeño temblor propio de cada dedo para que no se vea mecánico
    const temblor = 0.025 * Math.sin(t * 2.3 + i * 1.9) * Math.sin(t * 0.7 + i);

    let p = dedo.base;
    let d, eje;
    if (dedo.pulgar) {
      d = normalizar(girar(normalizar(dedo.dir), [0, 0, 1], -0.06 * ola * amplitud));
      eje = normalizar(cruz(d, [0.35, 0.1, 1]));
    } else {
      const ang = dedo.abre * (1 - 0.18 * ola * amplitud);
      d = [-Math.sin(ang), Math.cos(ang), 0];
      eje = normalizar(cruz(d, [0, 0, 1]));
    }

    J.set(p, i * 12);
    R[i * 4] = dedo.R[0];
    for (let j = 0; j < 3; j++) {
      const curva = dedo.curva[j] * (1 + 1.4 * ola * amplitud) + temblor;
      d = normalizar(girar(d, eje, curva));
      p = sumar(p, d, dedo.L[j]);
      J.set(p, i * 12 + (j + 1) * 3);
      R[i * 4 + j + 1] = dedo.R[j + 1];
    }
  });
}

/* ---------------- WebGL ---------------- */

function compilar(gl, tipo, fuente) {
  const s = gl.createShader(tipo);
  gl.shaderSource(s, fuente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function programa(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compilar(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, compilar(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programa: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const nombre = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[nombre] = gl.getUniformLocation(p, nombre);
  }
  return { p, u };
}

/**
 * Monta la mano en un contenedor (ocupa todo su ancho y alto).
 * @param {HTMLElement} contenedor
 * @param {object} [o]
 * @param {boolean} [o.movimientoReducido]  respiración casi quieta y disolución corta
 * @param {number}  [o.calidad]  1 = alta; se ajusta sola si el equipo va lento
 */
export function crearManoCromada(contenedor, o = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mano-cromada';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  contenedor.appendChild(canvas);

  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) {
    canvas.remove();
    throw new Error('Este navegador no tiene WebGL2');
  }

  const pMano = programa(gl, FRAG_MANO);
  const pPost = programa(gl, FRAG_POST);

  // Un triángulo que cubre toda la pantalla
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Textura donde se dibuja la mano (paso 1)
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let texW = 1, texH = 1;
  function prepararTextura(w, h) {
    texW = w; texH = h;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* --- calidad: si el equipo va lento, baja la resolución sola --- */
  const esChico = Math.min(screen.width, screen.height) < 768;
  let escala = o.calidad ?? (esChico ? 0.6 : 0.8);   // resolución de la mano respecto del canvas
  let rebote = esChico ? 0 : 1;                        // reflejos entre dedos
  let destellos = 1;
  const tiempos = [];

  function medir() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(contenedor.clientWidth * dpr));
    const h = Math.max(1, Math.round(contenedor.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const tw = Math.max(1, Math.round(w * escala));
    const th = Math.max(1, Math.round(h * escala));
    if (tw !== texW || th !== texH) prepararTextura(tw, th);
  }
  const ro = new ResizeObserver(medir);
  ro.observe(contenedor);
  medir();

  /* --- estado --- */
  const J = new Float32Array(60);
  const R = new Float32Array(20);
  const reducido = !!o.movimientoReducido;
  let pulso = false, glow = 0;
  let objetivoX = 0, objetivoY = 0, giroX = 0, giroY = 0;
  let disolucion = 0, disolviendo = null;
  let visible = true, vivo = true;
  const inicio = performance.now();
  let ultimo = inicio;

  // Deja de dibujar cuando no se ve (ahorra batería)
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(contenedor);

  function cuadro(ahora) {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    if (!visible || document.hidden) { ultimo = ahora; return; }

    const dt = Math.min((ahora - ultimo) / 1000, 0.05);
    ultimo = ahora;
    const t = (ahora - inicio) / 1000;

    // ajuste automático de calidad según lo que demora cada cuadro
    tiempos.push(dt);
    if (tiempos.length >= 45) {
      const prom = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
      tiempos.length = 0;
      if (prom > 0.026) {
        if (rebote) rebote = 0;
        else if (escala > 0.42) { escala *= 0.85; medir(); }
        else destellos = 0;
      }
    }

    // respiración y flotación
    articulaciones(t, reducido ? 0.25 : 1, J, R);
    const flota = reducido ? 0 : 1;
    const off = [0, Math.sin(t * 0.8) * 0.06 * flota, 0];

    // se inclina suave hacia donde está la mano de la persona
    giroX += (objetivoY - giroX) * Math.min(1, dt * 2.5);
    giroY += (objetivoX - giroY) * Math.min(1, dt * 2.5);
    const rot = matrizGiroInversa(
      -0.06 + 0.04 * Math.sin(t * 0.6) * flota + giroX,
      -0.12 + 0.10 * Math.sin(t * 0.45) * flota + giroY,
      -0.07 + 0.03 * Math.sin(t * 0.7 + 1.0) * flota,
    );

    // pulso (mobile): late suave para invitar a tocar
    const latido = pulso ? Math.pow(0.5 + 0.5 * Math.sin(t * 3.2), 3) : 0;
    glow += ((pulso ? latido : 0) - glow) * Math.min(1, dt * 8);
    const escalaMano = 1 + 0.03 * glow;

    if (disolviendo) {
      disolucion = Math.min(1, (ahora - disolviendo.inicio) / disolviendo.duracion);
      if (disolucion >= 1) {
        const fin = disolviendo.fin;
        disolviendo = null;
        fin();
      }
    }

    // Paso 1: mano en la textura
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, texW, texH);
    gl.useProgram(pMano.p);
    gl.uniform2f(pMano.u.uRes, texW, texH);
    gl.uniform1f(pMano.u.uTime, t);
    gl.uniform3fv(pMano.u.uJ, J);
    gl.uniform1fv(pMano.u.uR, R);
    gl.uniformMatrix3fv(pMano.u.uRot, false, rot);
    gl.uniform3fv(pMano.u.uOff, off);
    gl.uniform1f(pMano.u.uScale, escalaMano);
    gl.uniform1f(pMano.u.uGlow, glow);
    gl.uniform1f(pMano.u.uRebote, rebote);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Paso 2: a la pantalla
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(pPost.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(pPost.u.uTex, 0);
    gl.uniform2f(pPost.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(pPost.u.uTime, t);
    gl.uniform1f(pPost.u.uDis, disolucion);
    gl.uniform1f(pPost.u.uDestellos, destellos);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(cuadro);

  return {
    canvas,
    /** Pulso suave para invitar a tocar (mobile). */
    setPulso(v) { pulso = !!v; },
    /** Se inclina hacia la mano detectada. x, y de 0 a 1 (null = vuelve al centro). */
    setSeguir(x, y) {
      if (x == null) { objetivoX = 0; objetivoY = 0; return; }
      objetivoX = (x - 0.5) * 0.5;
      objetivoY = (y - 0.5) * 0.3;
    },
    /** Deshace la mano en píxeles. Devuelve una promesa que termina al acabar. */
    disolver(duracion = reducido ? 700 : 1900) {
      if (disolviendo || disolucion >= 1) return Promise.resolve();
      visible = true; // aunque esté fuera de pantalla, debe terminar
      return new Promise((fin) => { disolviendo = { inicio: performance.now(), duracion, fin }; });
    },
    /** Deja la disolución fija en un punto (0–1). Sirve para revisar el efecto cuadro a cuadro. */
    fijarDisolucion(v) { disolviendo = null; disolucion = v; },
    destruir() {
      vivo = false;
      ro.disconnect();
      io.disconnect();
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(buf);
      gl.deleteProgram(pMano.p);
      gl.deleteProgram(pPost.p);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    },
  };
}
