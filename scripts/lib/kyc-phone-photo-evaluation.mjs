/** Local-only evaluation of explicitly supplied, non-identity phone photos. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { createLocalOcrContext, disableNetwork, loadExistingEvidencePreparation } from './kyc-local-ocr-benchmark.mjs';

export const phonePhotoPrintedReference='6. A bag contains 4 red counters and 6 black counters. A counter is picked at random from the bag and not replaced. A second counter is then picked. Find the probability that a) the second counter is red, given that the first counter is red, 1/3 b) the counters are of different colours. 8/15';

export function phonePhotoPrintedCrop(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 100) throw new Error('invalid_photo_dimensions');
  return {left:Math.round(width*0.02),top:Math.round(height*0.11),width:Math.round(width*0.96),height:Math.round(height*0.19)};
}

function normalise(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}/]+/gu,' ').trim();
}
function editDistance(reference, observed) {
  let previous=Array.from({length:observed.length+1},(_,i)=>i);
  for(let i=1;i<=reference.length;i+=1){
    const current=[i];
    for(let j=1;j<=observed.length;j+=1) current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+Number(reference[i-1]!==observed[j-1]));
    previous=current;
  }
  return previous[observed.length];
}
export function scorePrintedText(observed, reference) {
  const expected=normalise(reference); const actual=normalise(observed);
  if(!expected) throw new Error('printed_reference_required');
  const expectedWords=expected.split(' '); const actualWords=actual?actual.split(' '):[];
  const characterErrors=editDistance([...expected],[...actual]); const wordErrors=editDistance(expectedWords,actualWords);
  return {exact:actual===expected,referenceCharacters:[...expected].length,characterErrors,
    characterErrorRate:characterErrors/[...expected].length,referenceWords:expectedWords.length,wordErrors,wordErrorRate:wordErrors/expectedWords.length};
}

export async function evaluatePhonePhotos({runtime, firstPhoto, secondPhoto, outputDirectory}) {
  const printedReference=phonePhotoPrintedReference;
  const context=await createLocalOcrContext(runtime);
  const prepare=await loadExistingEvidencePreparation();
  const output=path.resolve(outputDirectory);
  await fs.mkdir(output,{recursive:true,mode:0o700});
  const restore=disableNetwork();
  let worker;
  const results=[];
  try {
    worker=await context.makeWorker(['eng','msa']);
    const first=await fs.readFile(firstPhoto); const second=await fs.readFile(secondPhoto);
    const corrected=await sharp(first).rotate(180).png().toBuffer();
    const watermarkFirst=(await prepare(corrected,'image/png')).stored;
    const watermarkSecond=(await prepare(second,'image/png')).stored;
    const variants=[
      {id:'photo1-as-received-upside-down',bytes:first,upright:false},
      {id:'photo1-human-rotated180',bytes:corrected,upright:true},
      {id:'photo2-as-received',bytes:second,upright:true},
      {id:'photo1-human-rotated180-existing-watermark',bytes:watermarkFirst,upright:true},
      {id:'photo2-existing-watermark',bytes:watermarkSecond,upright:true},
      {id:'photo2-normalize-only',bytes:await sharp(second).normalise().png().toBuffer(),upright:true},
      {id:'photo2-upscale2x-only',bytes:await sharp(second).resize({width:2560}).png().toBuffer(),upright:true},
      {id:'photo2-normalize-upscale2x',bytes:await sharp(second).normalise().resize({width:2560}).png().toBuffer(),upright:true},
    ];
    for(const variant of variants){
      const start=performance.now();const recognized=await worker.recognize(variant.bytes);
      const row={variant:variant.id,wholePageMs:Math.round(performance.now()-start),
        engineTextConfidenceNotAccuracy:recognized.data.confidence,printedRegion:null};
      await fs.writeFile(path.join(output,`${variant.id}.txt`),recognized.data.text,{mode:0o600});
      if(variant.upright){
        const {width,height}=await sharp(variant.bytes).metadata();
        // Manually specified printed question region for these two maths-page
        // photos only. Not an automatic document detector or KYC crop rule.
        const box=phonePhotoPrintedCrop(width,height);
        const crop=await sharp(variant.bytes).extract(box).png().toBuffer();
        const begin=performance.now();const region=await worker.recognize(crop);
        row.printedRegion={cropBox:box,ms:Math.round(performance.now()-begin),...scorePrintedText(region.data.text,printedReference)};
        await fs.writeFile(path.join(output,`${variant.id}-printed-region.txt`),region.data.text,{mode:0o600});
      }
      results.push(row);console.log(`PHONE_OCR_RESULT ${JSON.stringify(row)}`);
    }
    const report={engine:'tesseract.js',version:context.version,languageCodes:['eng','msa'],offline:true,inputPhotos:2,
      referenceUsedOnlyAfterRecognition:true,manuallySelectedPrintedRegion:true,observationsPerVariant:1,
      normalization:'NFKC, lower-case, whitespace and punctuation except fraction slash normalised',results,
      limitations:['Maths-page photographs are not KYC evidence','No identity authentication, automatic approval or actual KYC upload was exercised',
        'Handwritten two-dimensional formula/tree structure is not validated by printed-region score','Only two supplied photos; no population accuracy estimate']};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    return report;
  } finally {
    if(worker) await worker.terminate();
    await context.close();restore();
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [runtime,firstPhoto,secondPhoto,outputDirectory]=process.argv.slice(2);
  if(!runtime||!firstPhoto||!secondPhoto||!outputDirectory) throw new Error('usage: runtime first-photo second-photo local-output-directory');
  await evaluatePhonePhotos({runtime,firstPhoto,secondPhoto,outputDirectory});
}
