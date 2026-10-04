import avatarPalette from './assets/avatar-style-palette.json' with { type: 'json' };
const C = avatarPalette.accessories;
import { NO_AVATAR_ACCESSORIES, type AvatarAccessories, type WorkspaceAvatarShape } from './workspace-avatar-profile.js';
const HEAD_Y: Partial<Record<WorkspaceAvatarShape, number>> = { bunny: 38, mushroom: 24, cloud: 29, heart: 24, star: 21, flower: 21, clover: 23, cat: 29, dumpling: 24, drop: 26, puddle: 42 };
function gradient(ctx: CanvasRenderingContext2D, y: number, light: string, dark: string) {
  const fill = ctx.createLinearGradient(30, y - 13, 66, y + 9); fill.addColorStop(0, light); fill.addColorStop(1, dark); return fill;
}
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rotation = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2); ctx.fill();
}
/** Accessories share the body's transform, not execution state or facial expression. */
export function drawAvatarAccessories(ctx: CanvasRenderingContext2D, shape: WorkspaceAvatarShape, chosen: AvatarAccessories | undefined, layer: 'head' | 'front') {
  const items = chosen ?? NO_AVATAR_ACCESSORIES;
  const y = HEAD_Y[shape] ?? 18;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (layer === 'head') {
    ctx.shadowColor = 'rgba(16,20,25,.16)'; ctx.shadowBlur = 1.6; ctx.shadowOffsetY = 1;
    if (items.head === 'beret') {
      ctx.fillStyle = gradient(ctx, y, C.beretLight, C.beretDark);
      ellipse(ctx, 50, y - 3, 24, 9.5, -.18); ellipse(ctx, 50, y - 14, 2.5, 3);
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.ellipse(50, y - 3, 21, 7.5, -.18, Math.PI, Math.PI * 1.85); ctx.stroke();
    } else if (items.head === 'detective' || items.head === 'cap') {
      const detective = items.head === 'detective';
      ctx.fillStyle = gradient(ctx, y, detective ? C.detectiveLight : C.capLight, detective ? C.detectiveDark : C.capDark);
      ctx.beginPath(); ctx.moveTo(27, y + 1); ctx.bezierCurveTo(27, y - 25, 72, y - 26, 73, y + 1); ctx.closePath(); ctx.fill();
      ellipse(ctx, detective ? 50 : 65, y + 1, detective ? 25 : 18, 4, detective ? 0 : .12);
      if (detective) { ellipse(ctx, 28, y + 3, 5, 9, .4); ellipse(ctx, 73, y + 3, 5, 9, -.4); }
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(25,20,19,.3)'; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(50, y - 16); ctx.lineTo(50, y - 2); ctx.stroke();
    } else if (items.head === 'sprout') {
      ctx.strokeStyle = C.sproutStem; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(50, y + 2); ctx.quadraticCurveTo(50, y - 9, 54, y - 14); ctx.stroke();
      ctx.fillStyle = gradient(ctx, y - 8, C.sproutLight, C.sproutDark);
      ellipse(ctx, 42, y - 11, 11, 5, .5); ellipse(ctx, 63, y - 12, 11, 5, -.5);
    } else if (items.head === 'headphones') {
      ctx.shadowBlur = 0; ctx.strokeStyle = C.headphoneBand; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(50, 47, 34, 30, 0, Math.PI, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = gradient(ctx, 48, C.headphoneLight, C.headphoneDark);
      ellipse(ctx, 17, 49, 6, 11); ellipse(ctx, 83, 49, 6, 11);
      ctx.fillStyle = C.headphonePad; ellipse(ctx, 15, 49, 2.5, 7); ellipse(ctx, 85, 49, 2.5, 7);
    }
  } else {
    if (items.eyes !== 'none') {
      ctx.strokeStyle = C.glassesFrame; ctx.lineWidth = 1.8;
      const eyes = items.eyes === 'glasses' ? [37, 61] : [61];
      for (const x of eyes) { ctx.beginPath(); ctx.ellipse(x, 51, 10, 11, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.lineWidth = 1.2;
      if (items.eyes === 'glasses') { ctx.beginPath(); ctx.moveTo(47, 49); ctx.quadraticCurveTo(49, 46, 51, 49); ctx.moveTo(27, 48); ctx.lineTo(23, 44); ctx.moveTo(71, 48); ctx.lineTo(75, 44); ctx.stroke(); }
      else { ctx.strokeStyle = C.monocleChain; ctx.beginPath(); ctx.moveTo(70, 59); ctx.quadraticCurveTo(79, 73, 72, 82); ctx.stroke(); }
    }
    if (items.neck === 'bow') {
      ctx.fillStyle = gradient(ctx, 76, C.bowLight, C.bowDark);
      ctx.beginPath(); ctx.moveTo(49, 76); ctx.bezierCurveTo(33, 64, 31, 80, 34, 84); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(51, 76); ctx.bezierCurveTo(67, 64, 69, 80, 66, 84); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.bowCenter; ellipse(ctx, 50, 77, 4, 4);
    } else if (items.neck === 'scarf') {
      ctx.fillStyle = gradient(ctx, 77, C.scarfLight, C.scarfDark);
      ctx.beginPath(); ctx.moveTo(23, 72); ctx.quadraticCurveTo(50, 84, 78, 72); ctx.lineTo(75, 80); ctx.quadraticCurveTo(50, 89, 25, 79); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(64, 77); ctx.lineTo(71, 79); ctx.lineTo(67, 96); ctx.lineTo(57, 93); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
