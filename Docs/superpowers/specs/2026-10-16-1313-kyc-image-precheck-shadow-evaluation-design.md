# KYC Image Pre-check Shadow Evaluation Design

Status: design for user review
Date: 2026-10-16
Branch: `feature/event-part`

## Context

The KYC upload path currently validates file type, byte size, decodability, and pixel bounds, strips image metadata, and stores watermarked evidence. Finalization enqueues a durable private pre-screening job. The worker and private OCR adapter exist in the current working tree, but the private OCR service has not been deployed or production-validated. There are no implemented blur, glare, document-count, document-type, specimen, or critical-field-visibility detectors.

The user supplied six varied images to evaluate realistic customer mistakes, including unclear, watermarked/specimen, unsupported-document, obstructed, and multi-document cases. Six cases are a robustness smoke set, not a representative accuracy sample and not enough to establish production thresholds.

## Decision

Start with a local-only shadow evaluation of explainable image checks. It reports what action each detector would recommend but does not change KYC submission responses, persist production results, request customer retakes, or approve/reject identity.

Use four action labels:

- `CONTINUE_OCR`: one supported document appears readable enough to continue extraction.
- `RESUBMIT`: a specific image defect appears to make the required evidence unusable.
- `MANUAL_REVIEW`: the signal is uncertain or may have a benign explanation.
- `UNSUPPORTED_DOCUMENT`: the image appears to show a document outside the supported KYC types.

OCR readability and image-quality signals are assistance only. `CONTINUE_OCR` never means the identity is authentic or the KYC case is approved. A specimen marker is a review signal; it is not a fraud finding. Unknown or conflicting signals fall back to `MANUAL_REVIEW`.

## Evaluation approach

Run local detectors over the six user-authorized images, using opaque case IDs and human-assigned expected actions. Candidate signals may include image orientation, a blur score, highlight/glare coverage, likely document count, document-type clues, specimen text clues, and whether required regions appear readable. Every proposed signal must report its evidence and limitations; no single opaque quality score decides the action.

Compare expected and observed actions per case. Report aggregate correct action count, false passes, and false resubmission recommendations. Do not include names, identity numbers, OCR text, source paths, image hashes, or face/biometric measurements in the report. Keep image bytes and intermediate outputs in a private local temporary directory and remove them after the run.

The evaluation may compare simple deterministic checks and existing local OCR capability. It must not send images to external AI/OCR APIs or add image fixtures, identity truth, or OCR output to the repository. Do not fit or tune a production threshold against these six cases.

## Reuse decisions

- `lib/kyc/submission.ts#validateKycUploadFile` — reuse as the baseline file acceptance contract; it is not a quality detector.
- `lib/kyc/evidence-image.ts#prepareKycEvidenceImage` — reuse as the existing decode, pixel-limit, metadata-removal, and watermark reference; do not change online behavior during this evaluation.
- `lib/kyc/prescreening.ts#processKycPrescreening` and `app/api/cron/process-kyc-prescreening/route.ts` — existing asynchronous processing boundary for a later integration; do not connect the local evaluation to production jobs now.
- `lib/kyc/ocr.ts#runKycOcr` — reuse only if a local-only OCR candidate is available; its private network contract is not permission to expose sample bytes to a remote service.
- `supabase/migrations/20261015192354_kyc_prescreening_operations.sql` — existing durable job/result schema remains unchanged in the shadow-evaluation phase.
- No reusable image-quality detector was found in `lib/kyc` or the KYC API/worker routes. Implementing a production detector is deferred until this experiment shows incremental value and a larger labeled set is available.

## Scope boundaries

In scope: local detector comparison, six-case expected-action evaluation, privacy-safe aggregate reporting, and a recommendation for the next validation step.

Out of scope: app/UI/API/database changes; production deployment; Hostinger, Supabase, or Cron changes; automatic retake or KYC decisions; training model weights; face matching, liveness, authenticity verification, or fraud classification; production thresholds or claims about 10,000 submissions/day or four-reviewer capacity.

## Risks and acceptance criteria

The main risk is overfitting six varied images: an apparently perfect score would only show that the checks recognize these examples. A second risk is false resubmission, which can burden legitimate customers. The report must keep those error types separate and state the sample-size limit.

Accept the evaluation when all six cases have expected-action labels; each candidate detector returns either an interpretable signal or an explicit unavailable/uncertain result; the report contains no sensitive identity data; expected-versus-observed actions and both error categories are visible; and the run makes no network request or production write.

Any later production integration requires a separate reviewed plan, a larger authorized and labeled image set, calibration across supported document types and capture conditions, and an explicit decision about when high-confidence resubmission advice may be shown. Human approval remains mandatory.
