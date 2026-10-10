"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Loader2 } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import { reportClientError } from "@/lib/client-log";
import { createLatestPick } from "@/lib/latest-pick";
import { prepareCprImage, type PrepareResult } from "@/lib/prepare-cpr-image";
import { cn } from "@/lib/utils";
import { btnSecondary } from "@/components/public/button-classes";
import { CprCardIcon } from "@/components/public/CprCardIcon";

export type CprImageFieldHandle = { pick: (file: File) => void };

type Props = {
  dict: Dictionary;
  value: Blob | null;
  onChange: (blob: Blob | null) => void;
  onBusyChange: (busy: boolean) => void;
  /** Already-translated text from the parent (client validation or server response). */
  error?: string;
  label?: string;
  hint?: string;
  /** Wrap the label in the step's h2 (focus target of the form). */
  asHeading?: boolean;
  /** Sets aria-required. Defaults to true. */
  required?: boolean;
  ref?: Ref<CprImageFieldHandle>;
};

export function CprImageField({ dict, value, onChange, onBusyChange, error, label, hint, asHeading, required = true, ref }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picker] = useState(createLatestPick);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [dragging, setDragging] = useState(false);
  const url = useMemo(() => (value ? URL.createObjectURL(value) : ""), [value]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  const table = dict.errors as Record<string, string>;
  const errors = {
    cpr_image_too_large: table.cpr_image_too_large ?? "",
    cpr_image_invalid: table.cpr_image_invalid ?? "",
  };

  function fail(message: string) {
    setLocalError(message);
    // Lets the donor pick the same file again and still get a change event.
    if (inputRef.current) inputRef.current.value = "";
  }

  function onFile(file: File | undefined) {
    return picker.pick(file, {
      start: () => {
        setLocalError("");
        onChange(null);
        setBusy(true);
        onBusyChange(true);
      },
      work: (f) =>
        prepareCprImage(f).catch((): PrepareResult => {
          reportClientError({ code: "image_prepare_failed", step: "photo" });
          return { ok: false, error: "cpr_image_invalid" };
        }),
      done: (result) => {
        setBusy(false);
        onBusyChange(false);
        if (result.ok) onChange(result.blob);
        else fail(errors[result.error]);
      },
    });
  }

  useImperativeHandle(ref, () => ({ pick: (f) => void onFile(f) }));

  function remove() {
    picker.cancel();
    setBusy(false);
    onBusyChange(false);
    onChange(null);
    setLocalError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const shownError = localError || error;
  const btn = btnSecondary + " h-11 flex-1 text-sm";
  const labelText = label ?? dict.join.cpr_image;
  const describedBy = ["f-cprImage-hint", shownError ? "f-cprImage-error" : ""].filter(Boolean).join(" ");

  return (
    <div>
      {asHeading ? (
        <h2 id="step-photo-title" tabIndex={-1} className="mb-2 text-2xl font-bold focus:outline-none">
          <label htmlFor="f-cprImage">{labelText}</label>
        </h2>
      ) : (
        <label htmlFor="f-cprImage" className="mb-2 block text-base font-medium text-ink">
          {labelText}
        </label>
      )}
      <input
        ref={inputRef}
        id="f-cprImage"
        type="file"
        accept="image/*"
        onChange={(e) => void onFile(e.target.files?.[0])}
        aria-busy={busy}
        aria-invalid={!!shownError}
        aria-required={required}
        aria-describedby={describedBy}
        className="peer sr-only"
      />
      {!value && (
        <label
          htmlFor="f-cprImage"
          data-drag={dragging || undefined}
          data-invalid={!!shownError || undefined}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onFile(e.dataTransfer.files?.[0]);
          }}
          className="flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-white p-6 text-center transition-colors hover:border-brand hover:bg-brand-tint/50 data-[drag]:border-brand data-[drag]:bg-brand-tint data-[invalid]:border-danger peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
        >
          {busy ? (
            <Loader2 className="size-8 animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <CprCardIcon />
          )}
          <span className="font-medium text-ink">{dict.join.cpr_drop_title}</span>
          <span className="hidden text-sm text-ink-soft sm:block">{dict.join.cpr_drop_desktop}</span>
        </label>
      )}
      {value && url && (
        <figure className="space-y-3 rounded-2xl border-2 border-line-strong bg-white p-3 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={dict.join.cpr_image_preview_alt} className="max-h-56 w-full rounded-xl object-contain" />
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => inputRef.current?.click()}>
              {dict.join.cpr_image_change}
            </button>
            <button type="button" className={cn(btn, "text-danger")} onClick={remove}>
              {dict.join.cpr_image_remove}
            </button>
          </div>
        </figure>
      )}
      <p id="f-cprImage-hint" className="mt-2 text-sm text-ink-soft">
        {hint ?? dict.join.cpr_image_hint}
      </p>
      <p aria-live="polite" className="mt-1 text-sm text-ink-soft">
        {busy && dict.join.cpr_image_processing}
      </p>
      {shownError && (
        <p id="f-cprImage-error" className="mt-1 text-sm font-medium text-danger">
          {shownError}
        </p>
      )}
    </div>
  );
}
