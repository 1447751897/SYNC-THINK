export const IMAGE_GENERATION_SIZES = [
  'auto',
  '1024x1024',
  '1024x1536',
  '1536x1024',
] as const;

export const IMAGE_GENERATION_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
export const IMAGE_GENERATION_COUNTS = [1, 2, 3, 4] as const;

export type ImageGenerationSize = (typeof IMAGE_GENERATION_SIZES)[number];
export type ImageGenerationQuality = (typeof IMAGE_GENERATION_QUALITIES)[number];
export type ImageGenerationCount = (typeof IMAGE_GENERATION_COUNTS)[number];

export interface ImageGenerationConfig {
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  count: ImageGenerationCount;
}

export const DEFAULT_IMAGE_GENERATION_CONFIG: Readonly<ImageGenerationConfig> = {
  size: 'auto',
  quality: 'auto',
  count: 1,
};

export function isImageGenerationConfig(value: unknown): value is ImageGenerationConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 3 &&
    keys.every((key) => key === 'size' || key === 'quality' || key === 'count') &&
    IMAGE_GENERATION_SIZES.includes(record.size as ImageGenerationSize) &&
    IMAGE_GENERATION_QUALITIES.includes(record.quality as ImageGenerationQuality) &&
    IMAGE_GENERATION_COUNTS.includes(record.count as ImageGenerationCount)
  );
}
