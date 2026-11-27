const rotations = [-11, 9, -6, 13, -8, 5, -12, 7, -4, 11, -9, 4];

/**
 * @param {{ id: string, size: number, rotation: number, radius: number, halfWidth: number }[]} pins
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

    return { id, size, rotation, radius, halfWidth: Math.max(artHalfWidth, labelHalfWidth) };
  });

  return { ...packRows(pins, width), labelWidth };
}
