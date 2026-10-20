"use client";

import { useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FeedbackItemBase {
  id: string;
  anchorId?: string;
  author: string;
  date: ReactNode;
  preview: ReactNode;
  content: ReactNode;
  title?: ReactNode;
  detailTitle?: ReactNode;
  avatar?: ReactNode;
  metadata?: ReactNode;
  verifiedLabel?: ReactNode;
  actions?: ReactNode;
}

export interface FeedbackReviewItem extends FeedbackItemBase {
  rating: number;
  ratingLabel: string;
}

export interface FeedbackTipItem extends FeedbackItemBase {
  rating?: never;
  ratingLabel?: never;
  verifiedLabel?: never;
}

type FeedbackCollectionProps =
  | {
      mode: "reviews";
      items: FeedbackReviewItem[];
      controls?: ReactNode;
      emptyState?: ReactNode;
    }
  | {
      mode: "tips";
      items: FeedbackTipItem[];
      controls?: ReactNode;
      emptyState?: ReactNode;
    };

function RatingStars({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={label}>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={14}
            className={star <= rating ? "fill-[var(--highlight-yellow)] text-[var(--highlight-yellow)]" : "text-muted-foreground/40"}
          />
        ))}
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </span>
  );
}

export function FeedbackCollection(props: FeedbackCollectionProps) {
  const { t } = useTranslation("customer");
  const [selected, setSelected] = useState<FeedbackItemBase | null>(null);
  const [selectedMode, setSelectedMode] = useState<FeedbackCollectionProps["mode"] | null>(null);
  const isReviewCollection = props.mode === "reviews";
  const selectedReview = selectedMode === "reviews" && selected ? selected as FeedbackReviewItem : null;

  return (
    <>
      {props.controls && <div className="mb-4 flex flex-wrap items-center gap-2">{props.controls}</div>}
      {props.items.length === 0 ? (
        props.emptyState ?? null
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.items.map((item) => {
            const review = props.mode === "reviews" ? item as FeedbackReviewItem : null;
            return (
              <article
                key={item.id}
                id={item.anchorId}
                className="group/feedback h-full overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/35 hover:shadow-sm"
              >
                <button
                  type="button"
                  data-feedback-trigger
                  aria-label={t(isReviewCollection ? "ui.feedback.openReview" : "ui.feedback.openTip", { author: item.author })}
                  onClick={() => { setSelected(item); setSelectedMode(props.mode); }}
                  className="block w-full rounded-t-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <div className="flex items-start gap-3">
                    {item.avatar}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{item.author}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">{item.date}</p>
                        </div>
                        {review && <RatingStars rating={review.rating} label={review.ratingLabel} />}
                      </div>
                      <p className="mt-2 line-clamp-1 text-sm leading-6 text-foreground/80">{item.preview}</p>
                      {item.metadata && <div className="mt-3 flex flex-wrap items-center gap-2">{item.metadata}</div>}
                      {item.verifiedLabel && <p className="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{item.verifiedLabel}</p>}
                    </div>
                  </div>
                </button>
                {item.actions && <footer className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-2">{item.actions}</footer>}
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[min(85vh,48rem)] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.detailTitle ?? selected.title ?? t(isReviewCollection ? "ui.feedback.reviewDetails" : "ui.feedback.tipDetails")}
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-start gap-3">
                {selected.avatar}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{selected.author}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{selected.date}</p>
                </div>
                {selectedReview && <RatingStars rating={selectedReview.rating} label={selectedReview.ratingLabel} />}
              </div>
              {selected.metadata && <div className="flex flex-wrap items-center gap-2">{selected.metadata}</div>}
              <div className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">{selected.content}</div>
              {selected.verifiedLabel && <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{selected.verifiedLabel}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
