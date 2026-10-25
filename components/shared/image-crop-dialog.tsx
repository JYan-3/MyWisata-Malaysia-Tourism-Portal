"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IMAGE_SHAPES, croppedFileName, croppedOutputSize, croppedOutputType, needsCrop, type ImageShape } from "@/lib/media/image-aspect";

type CropRequest = { url: string; file: File; shape: ImageShape; resolve: (file: File | null) => void };

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function exportCrop(request: CropRequest, area: Area): Promise<File> {
  const image = await loadImage(request.url);
  const size = croppedOutputSize(area);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size.width, size.height);
  const type = croppedOutputType(request.file.type);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("crop_failed");
  return new File([blob], croppedFileName(request.file.name, type), { type, lastModified: Date.now() });
}

/**
 * `cropToShape(file, shape)` resolves with the file unchanged when it already fits the shape,
 * otherwise opens the crop dialog and resolves with the cropped file, or null if cancelled.
 * Render `cropDialog` once in the uploader.
 */
export function useImageCrop() {
  const [request, setRequest] = useState<CropRequest | null>(null);

  const cropToShape = useCallback(async (file: File, shape: ImageShape): Promise<File | null> => {
    const url = URL.createObjectURL(file);
    let image: HTMLImageElement;
    try {
      image = await loadImage(url);
    } catch {
      // Not decodable here (e.g. HEIC): upload as-is and let the server's type check decide.
      URL.revokeObjectURL(url);
      return file;
    }
    if (!needsCrop(image.naturalWidth, image.naturalHeight, shape)) {
      URL.revokeObjectURL(url);
      return file;
    }
    return new Promise<File | null>((resolve) => setRequest({ url, file, shape, resolve }));
  }, []);

  const finish = (result: File | null) => {
    if (!request) return;
    URL.revokeObjectURL(request.url);
    request.resolve(result);
    setRequest(null);
  };

  const cropDialog = request ? <ImageCropDialog key={request.url} request={request} onDone={finish} /> : null;
  return { cropToShape, cropDialog };
}

function ImageCropDialog({ request, onDone }: { request: CropRequest; onDone: (file: File | null) => void }) {
  const { t } = useTranslation("common");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shape = IMAGE_SHAPES[request.shape];

  async function confirm() {
    if (!area) return;
    setBusy(true);
    setFailed(false);
    try {
      onDone(await exportCrop(request, area));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onDone(null); }}>
      <DialogContent className="sm:max-w-xl" data-image-crop-dialog={request.shape}>
        <DialogHeader>
          <DialogTitle>{t("imageCrop.title")}</DialogTitle>
          <DialogDescription>{t("imageCrop.description", { shape: shape.label })}</DialogDescription>
        </DialogHeader>
        <div className="relative h-72 overflow-hidden rounded-xl bg-muted sm:h-80">
          <Cropper image={request.url} crop={crop} zoom={zoom} aspect={shape.ratio} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} />
        </div>
        <label className="flex items-center gap-3 text-sm font-medium text-foreground">
          {t("imageCrop.zoom")}
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={busy} className="flex-1 accent-primary" />
        </label>
        {failed && <p role="alert" className="text-sm text-destructive">{t("imageCrop.failed")}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onDone(null)} disabled={busy}>{t("actions.cancel")}</Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy || !area}>{busy ? t("states.processingEllipsis") : t("imageCrop.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImageShapeHint({ shape, className = "text-[11px] text-muted-foreground" }: { shape: ImageShape; className?: string }) {
  const { t } = useTranslation("common");
  const { label, example } = IMAGE_SHAPES[shape];
  return <p className={className}>{t("imageCrop.hint", { shape: label, size: example })}</p>;
}
