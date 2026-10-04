import type { WorkspaceAvatarShape } from './workspace-avatar-profile.js';
import heart from './assets/plush/heart.png';
import diamond from './assets/plush/diamond.png';
import cat from './assets/plush/cat.png';
import ghost from './assets/plush/ghost.png';
import blob from './assets/plush/blob.png';
import pebble from './assets/plush/pebble.png';
import puddle from './assets/plush/puddle.png';
import droid from './assets/plush/droid.png';
import mech from './assets/plush/mech.png';
import alien from './assets/plush/alien.png';
import square from './assets/plush/square.png';
import pill from './assets/plush/pill.png';
import hexagon from './assets/plush/hexagon.png';
import star from './assets/plush/star.png';
import cloud from './assets/plush/cloud.png';
import flower from './assets/plush/flower.png';
import clover from './assets/plush/clover.png';
import drop from './assets/plush/drop.png';
import circle from './assets/plush/circle.png';
import triangle from './assets/plush/triangle.png';
import dumpling from './assets/plush/dumpling.png';
import bunny from './assets/plush/bunny.png';
import bean from './assets/plush/bean.png';
import mushroom from './assets/plush/mushroom.png';
const SOURCES: Record<WorkspaceAvatarShape, string> = { heart, diamond, cat, ghost, blob, pebble, puddle, droid, mech, alien, square, pill, hexagon, star, cloud, flower, clover, drop, circle, triangle, dumpling, bunny, bean, mushroom };
const images = new Map<string, Promise<HTMLImageElement>>();
const tinted = new Map<string, HTMLCanvasElement>();
export function loadPlushMaterial(shape: WorkspaceAvatarShape): Promise<HTMLImageElement> {
  const src = SOURCES[shape];
  let entry = images.get(src);
  if (!entry) {
    entry = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { images.delete(src); reject(new Error('avatar.material_load_failed')); };
      image.src = src;
    });
    images.set(src, entry);
  }
  return entry;
}
export function tintPlushMaterial(image: HTMLImageElement, shape: string, color: string): HTMLCanvasElement {
  const key = shape + ':' + color;
  const cached = tinted.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  const channels = [1, 3, 5].map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * .70 + 255 * .30));
  ctx.fillStyle = `rgb(${channels.join(',')})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(image, 0, 0);
  // A bounded material cache; colors are user-editable and must not grow forever.
  if (tinted.size >= 48) tinted.delete(tinted.keys().next().value!);
  tinted.set(key, canvas);
  return canvas;
}
