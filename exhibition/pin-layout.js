// Slot weights and angles are decided independently of the games. Coordinates
// describe clusters, with deliberate gaps and alternating baselines.
const slotPattern = [
  [104, -13], [138, 9], [92, -8], [122, 15], [88, -15],
  [113, 6], [100, -11], [126, 13], [84, -6], [101, 10],
  [118, -16], [107, 7], [95, -10], [136, 12], [94, -8],
];

const wide = [
  [],
  [[51, 0]],
  [[36, 6], [64, 23]],
  [[24, 27], [51, 0], [76, 22]],
  [[15, 5], [39, 44], [61, 0], [84, 30]],
  [[11, 18], [29, 0], [49, 53], [69, 13], [89, 37]],
];
const tablet = [
  [],
  [[51, 0]],
  [[32, 0], [68, 30]],
  [[19, 24], [52, 0], [82, 31]],
  [[13, 12], [38, 49], [62, 0], [87, 36]],
];
const mobile = [
  [],
  [[50, 0]],
  [[28, 0], [73, 27]],
  [[21, 0], [76, 32], [39, 102]],
];

function arrange(slots, templates, scale, labelSpace) {
  const capacity = templates.length - 1;
  let offset = 0;
  for (let start = 0, cluster = 0; start < slots.length; cluster++) {
    const remaining = slots.length - start;
    const count = remaining === capacity + 1 ? capacity - 1 : Math.min(remaining, capacity);
    const points = templates[count];
    const placed = slots.slice(start, start + count).map((slot, index) => {
      const [x, y] = points[index];
      const angle = Math.abs(slot.rotation) * Math.PI / 180;
      const extent = slot.size * scale * (Math.cos(angle) + Math.sin(angle)) / 2;
      return { x: cluster % 2 ? 100 - x : x, y, extent };
    });
    const top = Math.min(...placed.map(point => point.y - point.extent));
    const bottom = Math.max(...placed.map(point => point.y + point.extent + labelSpace));
    for (const [i, point] of placed.entries()) {
      slots[start + i].positions.push({ x: point.x, y: Math.round(point.y - top + offset) });
    }
    offset += bottom - top + 7;
    start += count;
  }
  return Math.ceil(offset);
}

export function placeRankedPins(rankedIds) {
  const count = rankedIds.length;
  const slots = Array.from({ length: count }, (_, index) => {
    const [weight, rotation] = slotPattern[index % slotPattern.length];
    return { index, weight, rotation, positions: [] };
  });
  const rankedSlots = [...slots].sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const [rank, slot] of rankedSlots.entries()) {
    slot.size = count === 1 ? 138 : 138 - 62 * rank / (count - 1);
    slot.id = rankedIds[rank];
  }
  const heights = [
    arrange(slots, wide, 1, 37),
    arrange(slots, tablet, .82, 34),
    arrange(slots, mobile, .64, 28),
  ];
  return { slots, heights };
}
