/** Explicitly invoked local-only tuning set; never an automatic KYC policy. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { createLocalOcrContext, disableNetwork, loadExistingEvidencePreparation, summarizeDurations } from './kyc-local-ocr-benchmark.mjs';
import { phonePhotoPrintedCrop, phonePhotoPrintedReference, scorePrintedText } from './kyc-phone-photo-evaluation.mjs';

const [runtime, firstPhoto, secondPhoto, outputDirectory, mode] = process.argv.slice(2);
if (!runtime || !firstPhoto || !secondPhoto || !outputDirectory) throw new Error('usage: runtime first-photo second-photo output-directory');
const output = path.resolve(outputDirectory);
await fs.mkdir(output, { recursive:true, mode:0o700 });
const context = await createLocalOcrContext(runtime);
const restore = disableNetwork();
const cpuStart = process.cpuUsage();
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => { peakRss=Math.max(peakRss,process.memoryUsage().rss); },50);
try {
  const prepare=await loadExistingEvidencePreparation();
  const first=await fs.readFile(firstPhoto);
  const second=await fs.readFile(secondPhoto);
  const corrected=await sharp(first).rotate(180).png().toBuffer();
  const photos=[
    {id:'photo1-human-rotated180',bytes:corrected},
    {id:'photo2-original',bytes:second},
    {id:'photo1-human-rotated180-watermark',bytes:(await prepare(corrected,'image/png')).stored},
    {id:'photo2-watermark',bytes:(await prepare(second,'image/png')).stored},
  ];
  const worker=await context.makeWorker(['eng','msa']);
  const configurations=[
    {id:'psm3',psm:'3',border:0,rotateAuto:false},
    {id:'psm6',psm:'6',border:0,rotateAuto:false},
    {id:'psm11',psm:'11',border:0,rotateAuto:false},
    {id:'psm3-border16',psm:'3',border:16,rotateAuto:false},
    {id:'psm6-border16',psm:'6',border:16,rotateAuto:false},
    {id:'psm11-border16',psm:'11',border:16,rotateAuto:false},
    {id:'psm6-border16-auto-deskew',psm:'6',border:16,rotateAuto:true},
    {id:'psm3-sauvola',psm:'3',border:0,rotateAuto:false,threshold:2},
    {id:'psm6-sauvola',psm:'6',border:0,rotateAuto:false,threshold:2},
    {id:'psm6-border16-sauvola',psm:'6',border:16,rotateAuto:false,threshold:2},
  ];
  const rows=[];
  for (const photo of photos) {
    const {width,height}=await sharp(photo.bytes).metadata();
    const box=phonePhotoPrintedCrop(width,height);
    const crop=await sharp(photo.bytes).extract(box).png().toBuffer();
    await fs.writeFile(path.join(output,`${photo.id}-printed-crop.png`),crop,{mode:0o600});
    for (const config of (mode === '--whole-page-only' ? [] : configurations)) {
      await worker.setParameters({tessedit_pageseg_mode:config.psm,thresholding_method:String(config.threshold ?? 0)});
      const observations=[];
      for (let repeat=0;repeat<3;repeat+=1) {
        const begin=performance.now();
        const input=config.border ? await sharp(crop).extend({top:config.border,bottom:config.border,left:config.border,right:config.border,background:'#fff'}).png().toBuffer() : crop;
        const recognizeBegin=performance.now();
        const {data}=await worker.recognize(input,{rotateAuto:config.rotateAuto});
        observations.push({ocrMs:Math.round(performance.now()-recognizeBegin),variantMs:Math.round(performance.now()-begin),
          engineConfidenceNotAccuracy:data.confidence,rotationRadians:data.rotateRadians ?? 0,...scorePrintedText(data.text,phonePhotoPrintedReference)});
        await fs.writeFile(path.join(output,`${photo.id}-${config.id}-run${repeat+1}.txt`),data.text,{mode:0o600});
      }
      const row={photo:photo.id,config,cropBox:box,observations,ocrTiming:summarizeDurations(observations.map(x=>x.ocrMs)),
        minCER:Math.min(...observations.map(x=>x.characterErrorRate)),maxCER:Math.max(...observations.map(x=>x.characterErrorRate))};
      rows.push(row);
      console.log(`TUNING_RESULT ${JSON.stringify({photo:row.photo,config:config.id,cer:row.maxCER,meanMs:row.ocrTiming.meanMs})}`);
    }
  }
  const wholePages=[];
  await worker.setParameters({tessedit_pageseg_mode:'3',thresholding_method:'2'});
  for (const photo of photos) {
    const begin=performance.now();
    const {data}=await worker.recognize(photo.bytes);
    await fs.writeFile(path.join(output,`${photo.id}-whole-page-sauvola.txt`),data.text,{mode:0o600});
    wholePages.push({photo:photo.id,ocrMs:Math.round(performance.now()-begin),psm:3,thresholdingMethod:2,
      engineConfidenceNotAccuracy:data.confidence,printedRegionScore:null});
  }
  // No orientation oracle: auto-deskew receives the actual upside-down image.
  // A known 180-degree correction above is explicitly human-provided.
  const orientation=[];
  for(const rotateAuto of [false,true]) {
    await worker.setParameters({tessedit_pageseg_mode:'3',thresholding_method:'0'});
    const begin=performance.now();
    const {data}=await worker.recognize(first,{rotateAuto});
    await fs.writeFile(path.join(output,`upside-down-auto-deskew-${rotateAuto}.txt`),data.text,{mode:0o600});
    orientation.push({rotateAuto,ms:Math.round(performance.now()-begin),rotationRadians:data.rotateRadians ?? 0,
      engineConfidenceNotAccuracy:data.confidence,automaticDocumentOrientationVerified:false});
  }
  const cpu=process.cpuUsage(cpuStart);
  const report={engine:'tesseract.js',version:context.version,offline:true,languages:['eng','msa'],
    dataset:'two supplied non-identity phone photos; tuning set, no independent holdout',referenceUsedOnlyAfterRecognition:true,
    humanCropAndFirstPhotoRotation:true,observationsPerVariant:3,rows,orientation,wholePages,
    harnessCpuSeconds:(cpu.user+cpu.system)/1e6,peakHarnessRssMiB:Math.round(peakRss/1024/1024),
    limits:['CER/WER only for selected printed question crop, not whole page or handwriting',
      'Repeat runs on same images are not independent accuracy samples or population p95',
      'Memory includes sharp, transpiler, Node and worker; not production or per-worker budget',
      'No KYC field accuracy, identity authenticity, upload integration or hosting capacity verified']};
  await fs.writeFile(path.join(output,mode === '--whole-page-only' ? 'tesseract-whole-page-report.json' : 'tesseract-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
} finally {
  clearInterval(sampler);
  try { await context.close(); } finally { restore(); }
}
