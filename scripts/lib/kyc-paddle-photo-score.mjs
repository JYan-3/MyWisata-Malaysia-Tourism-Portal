/** The reference is used here after Python inference has fully finished. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { phonePhotoPrintedReference, scorePrintedText } from './kyc-phone-photo-evaluation.mjs';
import { summarizeDurations } from './kyc-local-ocr-benchmark.mjs';
const [directory] = process.argv.slice(2);
if (!directory) throw new Error('usage: local-output-directory');
const output=path.resolve(directory);
const report=JSON.parse(await fs.readFile(path.join(output,'paddle-raw-report.json'),'utf8'));
for (const row of report.rows) {
  for (const observation of row.observations) Object.assign(observation,scorePrintedText(observation.text,phonePhotoPrintedReference));
  row.ocrTiming=summarizeDurations(row.observations.map(x=>x.ocrMs));
  row.minCER=Math.min(...row.observations.map(x=>x.characterErrorRate));
  row.maxCER=Math.max(...row.observations.map(x=>x.characterErrorRate));
  console.log(`PADDLE_SCORED ${JSON.stringify({photo:row.photo,cer:row.maxCER,meanMs:row.ocrTiming.meanMs})}`);
}
report.referenceUsedOnlyAfterRecognition=true;
await fs.writeFile(path.join(output,'paddle-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
