import { useEffect, useRef } from 'react';
import { HOST_BODY_TEXTURE } from './host-system-3d-asset.js';
import { createHostBodyGeometry, HOST_TURN_DURATION, hostTurnYaw } from './host-system-turn-geometry.js';

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform float uYaw;
varying vec3 vLocalPosition;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;
void main() {
  float c = cos(uYaw), s = sin(uYaw);
  mat3 turn = mat3(c, 0., -s, 0., 1., 0., s, 0., c);
  vec3 world = turn * aPosition;
  vLocalPosition = aPosition;
  vLocalNormal = aNormal;
  vWorldNormal = turn * aNormal;
  float distance = 6.0 - world.z;
  // Perspective camera, near=1 and far=12; depth buffering hides the far side.
  gl_Position = vec4(world.xy * 5.95, (13.0 / 11.0) * distance - 24.0 / 11.0, distance);
}`;
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uPortrait;
varying vec3 vLocalPosition;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;
void main() {
  vec2 frontUV = vec2(0.5 + vLocalPosition.x * 0.5, 0.5 - vLocalPosition.y * 0.5);
  vec4 front = texture2D(uPortrait, frontUV);
  // Sample eye-free fur for the sides/back. The original eyes belong only to
  // the front surface; there is no mirrored face on the rear of the model.
  vec2 furUV = vec2(0.30 + 0.40 * frontUV.x, 0.51 + 0.22 * frontUV.y);
  vec3 fur = texture2D(uPortrait, furUV).rgb;
  float face = smoothstep(0.15, 0.55, vLocalNormal.z) * front.a;
  vec3 material = mix(fur, front.rgb, face);
  vec3 normal = normalize(vWorldNormal);
  float diffuse = max(dot(normal, normalize(vec3(-0.45, 0.65, 1.0))), 0.0);
  float rim = pow(1.0 - max(normal.z, 0.0), 3.0);
  float light = 0.78 + 0.25 * diffuse + 0.07 * rim;
  gl_FragColor = vec4(material * light, 1.0);
}`;

/** On-demand true 3D rendering; no dependency or GPU context in history lists. */
export default function HostSystemTurn3D({ size, sequence, onReady, onComplete }: {
  size: number;
  sequence: number;
  onReady(): void;
  onComplete(): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let gl: WebGLRenderingContext | null = null;
    try { gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true }); }
    catch { /* Keep the supplied portrait if the device has no 3D renderer. */ }
    if (!gl) { onComplete(); return; }
    const context = gl;
    let disposed = false;
    let frame = 0;
    const shaders: WebGLShader[] = [];
    const buffers: WebGLBuffer[] = [];
    let program: WebGLProgram | null = null;
    let texture: WebGLTexture | null = null;
    const finish = () => { if (!disposed) onComplete(); };
    const compile = (type: number, source: string) => {
      const shader = context.createShader(type);
      if (!shader) throw new Error('host.turn.shader_missing');
      shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('host.turn.shader_invalid');
      return shader;
    };
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      try {
        program = context.createProgram();
        if (!program) throw new Error('host.turn.program_missing');
        context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX_SHADER));
        context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT_SHADER));
        context.linkProgram(program);
        if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error('host.turn.program_invalid');
        context.useProgram(program);
        const geometry = createHostBodyGeometry();
        const vertexBuffer = context.createBuffer();
        const indexBuffer = context.createBuffer();
        if (!vertexBuffer || !indexBuffer) throw new Error('host.turn.buffer_missing');
        buffers.push(vertexBuffer, indexBuffer);
        context.bindBuffer(context.ARRAY_BUFFER, vertexBuffer);
        context.bufferData(context.ARRAY_BUFFER, geometry.vertices, context.STATIC_DRAW);
        context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
        context.bufferData(context.ELEMENT_ARRAY_BUFFER, geometry.indices, context.STATIC_DRAW);
        for (const [name, offset] of [['aPosition', 0], ['aNormal', 12]] as const) {
          const location = context.getAttribLocation(program, name);
          context.enableVertexAttribArray(location);
          context.vertexAttribPointer(location, 3, context.FLOAT, false, 24, offset);
        }
        texture = context.createTexture();
        if (!texture) throw new Error('host.turn.texture_missing');
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, texture);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
        context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, image);
        context.uniform1i(context.getUniformLocation(program, 'uPortrait'), 0);
        const yaw = context.getUniformLocation(program, 'uYaw');
        const resolution = Math.max(64, Math.min(512, Math.ceil(size * Math.min(window.devicePixelRatio || 1, 2))));
        canvas.width = resolution; canvas.height = resolution;
        context.viewport(0, 0, resolution, resolution);
        context.enable(context.DEPTH_TEST);
        context.enable(context.CULL_FACE);
        context.clearColor(0, 0, 0, 0);
        let startedAt = performance.now();
        let lastSequence = sequenceRef.current;
        const draw = (now: number) => {
          if (disposed) return;
          if (lastSequence !== sequenceRef.current) { lastSequence = sequenceRef.current; startedAt = now; }
          const progress = Math.max(0, Math.min(1, (now - startedAt) / HOST_TURN_DURATION));
          const angle = hostTurnYaw(progress);
          context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
          context.uniform1f(yaw, angle);
          context.drawElements(context.TRIANGLES, geometry.indices.length, context.UNSIGNED_SHORT, 0);
          canvas.dataset.yaw = String(angle);
          if (progress < 1) frame = requestAnimationFrame(draw);
          else finish();
        };
        draw(startedAt);
        onReady();
      } catch { finish(); }
    };
    image.onerror = finish;
    const visibility = () => { if (document.hidden) finish(); };
    const lost = (event: Event) => { event.preventDefault(); finish(); };
    document.addEventListener('visibilitychange', visibility);
    canvas.addEventListener('webglcontextlost', lost);
    image.src = HOST_BODY_TEXTURE;
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      image.onload = null; image.onerror = null;
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', lost);
      for (const buffer of buffers) context.deleteBuffer(buffer);
      if (texture) context.deleteTexture(texture);
      if (program) context.deleteProgram(program);
      for (const shader of shaders) context.deleteShader(shader);
      context.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [size, onReady, onComplete]);

  return <canvas ref={canvasRef} className="shell-host-3d" data-renderer="solid-webgl" aria-hidden="true" />;
}
