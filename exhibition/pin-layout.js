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

/**
 * @param {Parameters<typeof pack>[0]} pins
 * @param {number} width
 */
function packRows(pins, width) {
  const minGap = 4;
  const maxGap = 24;
  const rowGap = 2;
  const rows = [];
  let row = [];
  let used = 0;
  for (const pin of pins) {
    const pinWidth = 2 * pin.halfWidth;
    if (row.length && used + minGap * row.length + pinWidth > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(pin);
    used += pinWidth;
  }
  rows.push(row);

  // Share the last row with the preceding one when a single pin would be stranded.
  const last = rows.at(-1);
  const previous = rows.at(-2);
  if (last.length === 1 && previous?.length > 2) {
    const pin = previous.at(-1);
    if (2 * (pin.halfWidth + last[0].halfWidth) + minGap <= width) {
      last.unshift(previous.pop());
    }
  }

  let top = 0;
  const slots = rows.flatMap((row, rowIndex) => {
    const occupied = row.reduce((sum, pin) => sum + 2 * pin.halfWidth, 0);
    const gap = row.length > 1 ? Math.min(maxGap, (width - occupied) / (row.length - 1)) : 0;
    let left = (width - occupied - gap * (row.length - 1)) / 2;
    const artBottom = top + 2 * Math.max(...row.map(pin => pin.radius)) + 4;
    top = artBottom + 35 + rowGap;
    return row.map(({ id, size, rotation, radius, halfWidth }, column) => {
      const x = left + halfWidth;
      left += 2 * halfWidth + gap;
      const y = artBottom - radius - (rowIndex + column) % 3 * 2;
      return { id, size, rotation, radius, x, y };
    });
  });
  return { slots, height: Math.ceil(top - rowGap) };
}

/**
 * @param {readonly string[]} rankedIds
 * @param {number} width
 * @returns {{ slots: { id: string, size: number, rotation: number, radius: number, x: number, y: number }[], height: number, labelWidth: number }}
 */
export function placeRankedPins(rankedIds, width) {
  if (!rankedIds.length || width <= 0) return { slots: [], height: 0, labelWidth: 0 };

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
  const shortest = layouts.reduce((best, layout) => layout.height < best.height ? layout : best);
  const rows = packRows(pins, width);
  // Give the ordered rows a small allowance, with compact packing for narrow
  // widths where a whole extra row would leave much more empty space.
  const best = rows.height <= shortest.height * 1.1 ? rows : shortest;
  const byId = new Map(best.slots.map(slot => [slot.id, slot]));
  return { slots: rankedIds.map(id => byId.get(id)), height: best.height, labelWidth };
}
