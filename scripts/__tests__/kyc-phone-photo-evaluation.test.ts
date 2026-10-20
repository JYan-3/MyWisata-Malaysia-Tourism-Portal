import { describe, expect, it } from 'vitest';
import { phonePhotoPrintedCrop, scorePrintedText } from '../lib/kyc-phone-photo-evaluation.mjs';
describe('phone-photo printed-region scoring', () => {
  it('uses the same bounded reference crop at original and double size', () => {
    expect(phonePhotoPrintedCrop(1280, 960)).toEqual({ left:26, top:106, width:1229, height:182 });
    const box=phonePhotoPrintedCrop(2560, 1920);
    expect(box.left+box.width).toBeLessThanOrEqual(2560);
    expect(box.top+box.height).toBeLessThanOrEqual(1920);
    expect(() => phonePhotoPrintedCrop(0, 960)).toThrow('invalid_photo_dimensions');
  });
  it('scores the full reference rather than keyword presence', () => {
    expect(scorePrintedText('A bag contains 4 red counters.', 'A bag contains 6 red counters.')).toMatchObject({ exact: false, wordErrors: 1, referenceWords: 6 });
  });
  it('ignores layout whitespace/case but retains printed fractions', () => {
    expect(scorePrintedText('  A BAG\ncontains 1/3. ', 'A bag contains 1/3')).toMatchObject({ exact: true, wordErrors: 0, characterErrors: 0 });
  });
  it('treats missing recognition as failure, not an empty successful match', () => {
    expect(scorePrintedText('', 'A bag')).toMatchObject({ exact:false, wordErrorRate:1, characterErrorRate:1 });
  });
});
