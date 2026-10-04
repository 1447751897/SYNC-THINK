import { describe, expect, it } from 'vitest';
import { createHostBodyGeometry, HOST_BODY_DEPTH, HOST_TURN_DURATION, hostTurnYaw } from './host-system-turn-geometry.js';

describe('solid host body geometry', () => {
  it('builds a closed mesh with real depth, finite outward unit normals and valid triangles', () => {
    const { vertices, indices } = createHostBodyGeometry();
    expect(vertices.length).toBeGreaterThan(10000);
    expect(indices.length % 3).toBe(0);
    expect(Math.max(...indices)).toBeLessThan(vertices.length / 6);
    const depth = [];
    for (let i = 0; i < vertices.length; i += 6) {
      expect([...vertices.slice(i, i + 6)].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...vertices.slice(i + 3, i + 6))).toBeCloseTo(1, 5);
      depth.push(vertices[i + 2]);
    }
    expect(Math.max(...depth)).toBeCloseTo(HOST_BODY_DEPTH);
    expect(Math.min(...depth)).toBeCloseTo(-HOST_BODY_DEPTH);
  });

  it('has a thick profile, not a disappearing 2D card', () => {
    const { vertices } = createHostBodyGeometry();
    const xs = [], zs = [];
    for (let i = 0; i < vertices.length; i += 6) { xs.push(vertices[i]); zs.push(vertices[i + 2]); }
    const frontWidth = Math.max(...xs) - Math.min(...xs);
    const profileWidth = Math.max(...zs) - Math.min(...zs);
    expect(profileWidth / frontWidth).toBeGreaterThan(0.5);
  });

  it('makes one smooth upright turn from front through back to front', () => {
    expect(HOST_TURN_DURATION).toBe(1200);
    expect(hostTurnYaw(0)).toBe(0);
    expect(hostTurnYaw(0.5)).toBeCloseTo(Math.PI);
    expect(hostTurnYaw(1)).toBeCloseTo(2 * Math.PI);
    expect(hostTurnYaw(-1)).toBe(0);
    expect(hostTurnYaw(2)).toBeCloseTo(2 * Math.PI);
  });
});
