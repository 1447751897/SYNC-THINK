import { describe, expect, it } from 'vitest';
import {
  buildGeneratedImageModelBySrc,
  computeImageLightboxFitScale,
  imagesFromHastParagraph,
  parseGeneratedImageModels,
  resolveGeneratedImageModel,
  resolveGalleryGeneratedImageModel,
} from './markdown-image-gallery.js';

describe('parseGeneratedImageModels', () => {
  it('maps 模型： lines onto following markdown images', () => {
    const markdown = [
      '图像已生成并保存。',
      '保存路径：.sync-think/generated-images/a.png',
      '供应商：OpenAI',
      '模型：gpt-image-2',
      '',
      '![生成的图片](sync-think-image://generated/a.png)',
    ].join('\n');
    expect(parseGeneratedImageModels(markdown).get('sync-think-image://generated/a.png')).toBe(
      'gpt-image-2',
    );
  });

  it('resolves encoded generated-image URLs the way NewMax matches local paths', () => {
    const absolute = 'D:\\work\\.sync-think\\generated-images\\card.png';
    const encoded = `sync-think-image://generated/${encodeURIComponent(absolute)}`;
    const markdown = ['模型：gpt-image-2', '', `![生成的图片](${encoded})`].join('\n');
    const models = parseGeneratedImageModels(markdown);
    expect(resolveGeneratedImageModel(encoded, models)).toBe('gpt-image-2');
    expect(resolveGeneratedImageModel(`sync-think-image://generated/${absolute}`, models)).toBe(
      'gpt-image-2',
    );
  });
});

describe('buildGeneratedImageModelBySrc', () => {
  it('reads 模型： from generate_image tool results', () => {
    const result = [
      '图像已生成并保存。',
      '模型：gpt-image-2',
      '',
      '![生成的图片](sync-think-image://generated/a.png)',
    ].join('\n');
    const models = buildGeneratedImageModelBySrc([result]);
    expect(resolveGalleryGeneratedImageModel([{ src: 'sync-think-image://generated/a.png' }], models)).toBe(
      'gpt-image-2',
    );
  });

  it('unwraps JSON content blocks the way NewMax normalizes tool output', () => {
    const result = JSON.stringify({
      content: [
        {
          text: '模型：gpt-image-2\n\n![生成的图片](sync-think-image://generated/b.png)',
        },
      ],
    });
    expect(
      resolveGeneratedImageModel(
        'sync-think-image://generated/b.png',
        buildGeneratedImageModelBySrc([result]),
      ),
    ).toBe('gpt-image-2');
  });
});

describe('imagesFromHastParagraph', () => {
  it('collects consecutive images and rejects mixed text', () => {
    expect(
      imagesFromHastParagraph({
        children: [
          {
            type: 'element',
            tagName: 'img',
            properties: { src: 'a.png', alt: 'a' },
          },
          {
            type: 'element',
            tagName: 'img',
            properties: { src: 'b.png', alt: 'b' },
          },
        ],
      }),
    ).toEqual([
      { src: 'a.png', alt: 'a' },
      { src: 'b.png', alt: 'b' },
    ]);
    expect(
      imagesFromHastParagraph({
        children: [
          { type: 'text', value: 'see ' },
          { type: 'element', tagName: 'img', properties: { src: 'a.png' } },
        ],
      }),
    ).toBeNull();
  });
});

describe('computeImageLightboxFitScale', () => {
  it('matches NewMax: subtract 96px padding and never scale above 1', () => {
    expect(
      computeImageLightboxFitScale(
        'screen',
        { width: 2000, height: 1000 },
        { width: 1000, height: 800 },
      ),
    ).toBeCloseTo(0.452, 3);
    expect(
      computeImageLightboxFitScale(
        'width',
        { width: 2000, height: 1000 },
        { width: 1000, height: 800 },
      ),
    ).toBeCloseTo(0.452, 3);
    expect(
      computeImageLightboxFitScale(
        'screen',
        { width: 800, height: 600 },
        { width: 1000, height: 800 },
      ),
    ).toBe(1);
    expect(
      computeImageLightboxFitScale(
        'width',
        { width: 800, height: 600 },
        { width: 1000, height: 800 },
      ),
    ).toBe(1);
  });
});
