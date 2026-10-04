import { HOST_BODY_OUTLINE } from './host-system-3d-asset.js';

export const HOST_TURN_DURATION = 1200;
export const HOST_BODY_DEPTH = 0.63;

/** A closed, inflated mesh: front and back poles share the portrait's alpha
 * silhouette at the equator. Unlike a rotated quad it keeps volume in profile. */
export function createHostBodyGeometry(rings = 32) {
  const segments = HOST_BODY_OUTLINE.length;
  const stride = segments + 1;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rings; row++) {
    const latitude = row * Math.PI / rings;
    const sinLat = Math.sin(latitude);
    const cosLat = Math.cos(latitude);
    for (let column = 0; column <= segments; column++) {
      const index = column % segments;
      const theta = index * Math.PI * 2 / segments;
      const radius = HOST_BODY_OUTLINE[index];
      const derivative = (HOST_BODY_OUTLINE[(index + 1) % segments]
        - HOST_BODY_OUTLINE[(index + segments - 1) % segments]) / (4 * Math.PI / segments);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      let nx = HOST_BODY_DEPTH * sinLat * (radius * cos + derivative * sin);
      let ny = HOST_BODY_DEPTH * sinLat * (radius * sin - derivative * cos);
      let nz = radius * radius * cosLat;
      const length = Math.hypot(nx, ny, nz);
      nx /= length; ny /= length; nz /= length;
      // position and outward unit normal, interleaved.
      vertices.push(radius * sinLat * cos, radius * sinLat * sin, HOST_BODY_DEPTH * cosLat, nx, ny, nz);
      if (row < rings && column < segments) {
        const a = row * stride + column;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

export function hostTurnYaw(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return (t * t * (3 - 2 * t)) * Math.PI * 2;
}
