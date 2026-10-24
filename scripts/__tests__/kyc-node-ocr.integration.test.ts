import { expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureSvg } from '../../lib/kyc/runtime/ocr-synthetic-fixtures.cjs';
import { prepareKycEvidenceImage } from '../../lib/kyc/evidence-image';
import { extractKycFieldsInNode } from '../../lib/kyc/node-ocr-engine';

it('recognizes fixed watermarked synthetic fields with installed offline models', async () => {
  const create = async (side: 'front' | 'back') => ({ mimeType: 'image/png', bytes: new Uint8Array((await prepareKycEvidenceImage(await sharp(fixtureSvg(side, 'SYNTHETIC PERSON', '990101-14-0001')).png().toBuffer(), 'image/png')).stored) });
  const result = await extractKycFieldsInNode({ documentType: 'national_id', front: await create('front'), back: await create('back') }, 20000);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.fields.documentNumber === '990101140001').toBe(true);
  expect(result.fields.holderName === 'SYNTHETIC PERSON').toBe(true);
  expect(result.metrics.manifest.models.every((model) => /^[a-f0-9]{64}$/.test(model.sha256))).toBe(true);
  await mkdir('output/kyc-node-ocr', { recursive: true });
  await writeFile('output/kyc-node-ocr/model-manifest.json', JSON.stringify(result.metrics.manifest, null, 2) + '\n');
}, 25000);
