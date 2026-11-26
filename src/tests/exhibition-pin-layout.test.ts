import { describe, expect, it } from 'vitest';
import { placeRankedPins } from '../../exhibition/pin-layout.js';

const ids = Array.from({ length: 12 }, (_, index) => `game-${index}`);

describe('exhibition pin layout', () => {
  it('keeps mobile pins large and packs a dozen pins into a shorter display', () => {
    const { slots, height } = placeRankedPins(ids, 360);
    expect(slots.map(pin => pin.id)).toEqual(ids);
    expect(slots[0].size).toBeGreaterThan(slots[11].size);
    expect(slots[11].size).toBeGreaterThanOrEqual(66);
    expect(height).toBeLessThan(600);
    expect(placeRankedPins(ids, 360)).toEqual({ slots, height, labelWidth: 84 });
  });

  it.each([280, 344, 360, 768, 1110])('keeps art and labels inside %ipx without overlap', width => {
    const { slots, height, labelWidth } = placeRankedPins(ids, width);
    const rectangles = slots.flatMap(({ x, y, radius }) => [
      { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius },
      { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y + radius + 3, bottom: y + radius + 31 },
    ]);
    for (const [index, box] of rectangles.entries()) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(height);
      for (const previous of rectangles.slice(0, index)) {
        const overlaps = box.left < previous.right && previous.left < box.right
          && box.top < previous.bottom && previous.top < box.bottom;
        expect(overlaps).toBe(false);
      }
    }
  });
});
