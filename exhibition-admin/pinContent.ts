import { exhibitionImageUrl, exhibitionPins, fallbackExhibitionPin, isExhibitionImageUpload } from '../src/domain/exhibition/presentation';
import type { StudioLanguage } from './language';

export type GameChoice = { id: string; names: Record<StudioLanguage, string>; searchTitles: string[]; defaultPin: string };
export type PinContent = {
  mapping: ReadonlyMap<string, string>;
  descriptions: Record<string, string>;
  images: Record<string, string>;
};

const pinAssets = import.meta.glob<string>('../exhibition/assets/pins/*.webp', { eager: true, query: '?url', import: 'default' });

export function contentForGame(game: GameChoice, content: PinContent) {
  const gameKey = fallbackExhibitionPin(game.id);
  const mapped = content.mapping.get(game.id);
  const pin = mapped === '' ? game.defaultPin : mapped ?? game.defaultPin;
  const imageKey = content.images[gameKey]?.trim() ? gameKey : pin;
  const imageConfig = content.images[imageKey];
  const bundledImage = exhibitionPins[pin]?.pending ? undefined : pinAssets[`../exhibition/assets/pins/${pin}.webp`];
  const defaultDescription = (pin !== gameKey ? content.descriptions[pin] : undefined) ?? exhibitionPins[pin]?.motif ?? '';
  const description = content.descriptions[gameKey] ?? defaultDescription;
  return {
    gameKey, imageKey, imageConfig, bundledImage, defaultDescription, description, excluded: mapped === '',
    hasImage: Boolean(isExhibitionImageUpload(imageConfig) || exhibitionImageUrl(imageConfig) || bundledImage),
    hasDescription: Boolean(description.trim()),
  };
}
