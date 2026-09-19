// Custom GLSL shaders.
//  - SKY: graduated atmosphere gradient (zenith → horizon) with sun glow.
//    The horizon color matches the scene fog so terrain melts into the sky.
//  - POST: minimal post chain — subtle vignette, chromatic aberration that
//    spikes only on impacts (uCA driven by EffectsManager), film grain.

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  // Gentle two-stop gradient: warm haze near the horizon, muted blue zenith.
  float t = smoothstep(-0.06, 0.34, h);
  vec3 col = mix(uHorizon, uZenith, t);
  // Sun disc + soft halo.
  vec3 sun = normalize(uSunDir);
  float disc = pow(max(dot(d, sun), 0.0), 420.0);
  float halo = pow(max(dot(d, sun), 0.0), 10.0) * 0.10;
  col += uSunColor * (disc * 1.6 + halo);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const POST_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uCA;       // chromatic aberration intensity (0 = off)
uniform float uVignette;
uniform float uGrain;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float dist = length(cc);

  // Radial chromatic aberration, strongest near the edges (uCA is momentary).
  vec2 dir = cc / max(dist, 1e-4);
  vec2 off = dir * uCA * 0.018 * dist * dist;
  float r = texture2D(tDiffuse, uv + off).r;
  float g = texture2D(tDiffuse, uv).g;
  float b = texture2D(tDiffuse, uv - off).b;
  vec3 col = vec3(r, g, b);

  // Subtle vignette.
  col *= 1.0 - uVignette * smoothstep(0.5, 1.15, dist);

  // Film grain.
  col += (hash(uv * 113.7 + fract(uTime * 60.0)) - 0.5) * uGrain;

  gl_FragColor = vec4(col, 1.0);
}
`;
