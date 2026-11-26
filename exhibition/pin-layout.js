const rotations = [-11, 9, -6, 13, -8, 5, -12, 7, -4, 11, -9, 4];
const horizontalBias = [.20, .84, .47, .12, .86, .56, .35, .67];

function findPosition(boxes, width, pin, index, fromRight) {
  const limit = width - pin.halfWidth;
  const preferred = pin.halfWidth + (limit - pin.halfWidth) * horizontalBias[index % horizontalBias.length];
  let best;

  for (let x = pin.halfWidth; ; x = Math.min(x + 4, limit)) {
    const blocked = [];
    for (const part of pin.parts) {
      for (const box of boxes) {
        if (Math.abs(x - box.x) < part.halfWidth + box.halfWidth) {
          blocked.push([box.top - part.bottom, box.bottom - part.top]);
        }
      }
    }
    blocked.sort((a, b) => a[0] - b[0]);

    let y = pin.radius + 3 + (index * 7) % 9;
    for (const [from, to] of blocked) {
      if (y <= from) break;
      y = Math.max(y, to);
    }
    const edgeDistance = fromRight ? limit - x : x - pin.halfWidth;
    const score = y + edgeDistance / width * 9 + Math.abs(x - preferred) / width * 3;
    if (!best || score < best.score) best = { x, y, score };
    if (x === limit) return best;
  }
}

function pack(pins, width, fromRight) {
  const boxes = [];
  const slots = pins.map((pin, index) => {
    const { x, y } = findPosition(boxes, width, pin, index, fromRight);
    for (const { halfWidth, top, bottom } of pin.parts) {
      boxes.push({ x, halfWidth, top: y + top, bottom: y + bottom });
    }
    return { id: pin.id, size: pin.size, rotation: pin.rotation, radius: pin.radius, x, y };
  });

  const left = Math.min(...boxes.map(box => box.x - box.halfWidth));
  const right = Math.max(...boxes.map(box => box.x + box.halfWidth));
  const offset = (width - right - left) / 2;
  return {
    slots: slots.map(slot => ({ ...slot, x: slot.x + offset })),
    height: Math.ceil(Math.max(...boxes.map(box => box.bottom))),
  };
}

export function placeRankedPins(rankedIds, width) {
  if (!rankedIds.length || width <= 0) return { slots: [], height: 0 };

  const scale = Math.max(0, Math.min(1, (width - 360) / 640));
  const minSize = 66 + 26 * scale;
  const maxSize = 98 + 50 * scale;
  const labelWidth = Math.min(width * .9, Math.round(84 + 36 * scale));
  const pins = rankedIds.map((id, index) => {
    const rank = index / Math.max(1, rankedIds.length - 1);
    const rotation = rotations[index % rotations.length];
    const angle = Math.abs(rotation) * Math.PI / 180;
    const rotationScale = (Math.cos(angle) + Math.sin(angle)) * 1.045;
    const size = Math.min(maxSize - (maxSize - minSize) * rank ** .42, width / (rotationScale + .1));
    const radius = Math.min(width / 2, Math.ceil(size * rotationScale / 2) + 3);
    const labelHalfWidth = Math.min(width / 2, labelWidth / 2 + 3);
    const artHalfWidth = Math.min(width / 2, radius + 2);

    return { id, size, rotation, radius, halfWidth: Math.max(artHalfWidth, labelHalfWidth), parts: [
      { halfWidth: artHalfWidth, top: -radius, bottom: radius + 3 },
      { halfWidth: labelHalfWidth, top: radius + 3, bottom: radius + 35 },
    ] };
  });

  // Compare largest-first packing with a pass that brings smaller pins into
  // the early gaps. Both passes keep the original size and angle of each pin.
  const interleaved = [];
  for (let first = 0, last = pins.length - 1; first <= last; first++, last--) {
    interleaved.push(pins[first]);
    if (first < last) interleaved.push(pins[last]);
  }
  const layouts = [pack(pins, width, false), pack(pins, width, true),
    pack(interleaved, width, false), pack(interleaved, width, true)];
  const best = layouts.reduce((shortest, layout) => layout.height < shortest.height ? layout : shortest);
  const byId = new Map(best.slots.map(slot => [slot.id, slot]));
  return { slots: rankedIds.map(id => byId.get(id)), height: best.height, labelWidth };
}
