import { Color } from "three";

/** Shared look of the petal burst (used by the landing hero and the ambient app background). */
export const CORE = new Color("#f59e5b"); // warm orange at the centre
export const TIP = new Color("#5fd3a0"); // teal green at the tips

export const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

// A soft-edged tapered petal: u runs base(0) -> tip(1), v across (-1..1). Alpha fades smoothly (blurred look).
export const FRAG = `
varying vec2 vUv;
uniform vec3 uCore; uniform vec3 uTip; uniform float uOpacity; uniform float uGlow; uniform float uSoft;
void main(){
  float u = vUv.x;
  float v = vUv.y * 2.0 - 1.0;
  float prof = pow(sin(3.14159265 * pow(clamp(u, 0.0, 1.0), 0.55)), 1.0);
  float d = abs(v) / max(prof, 0.0005);
  float a = smoothstep(1.0, 1.0 - uSoft, d);
  a *= smoothstep(0.0, 0.05, u);
  vec3 col = mix(uCore, uTip, smoothstep(0.0, 0.95, u)) + vec3(uGlow);
  gl_FragColor = vec4(col, a * uOpacity);
}`;
