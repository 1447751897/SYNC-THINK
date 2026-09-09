import { describe, expect, it } from 'vitest';
import {
  imagesFromHastParagraph,
  parseGeneratedImageModels,
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
