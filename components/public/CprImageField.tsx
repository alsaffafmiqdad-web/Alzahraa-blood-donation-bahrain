"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { createLatestPick } from "@/lib/latest-pick";
import { prepareCprImage, type PrepareResult } from "@/lib/prepare-cpr-image";

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
};

export function CprImageField({ dict, value, onChange, onBusyChange, error, label, hint, asHeading, required = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picker] = useState(createLatestPick);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
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
      work: (f) => prepareCprImage(f).catch((): PrepareResult => ({ ok: false, error: "cpr_image_invalid" })),
      done: (result) => {
        setBusy(false);
        onBusyChange(false);
        if (result.ok) onChange(result.blob);
        else fail(errors[result.error]);
      },
    });
  }

  function remove() {
    picker.cancel();
    setBusy(false);
    onBusyChange(false);
    onChange(null);
    setLocalError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const shownError = localError || error;
  const btn =
    "min-h-11 rounded-xl border-2 border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper-2 focus-visible:ring-4 focus-visible:ring-crimson/20 focus-visible:outline-none";
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
        className="block w-full text-base text-ink file:me-3 file:h-12 file:rounded-xl file:border-2 file:border-line file:bg-white file:px-4 file:text-sm file:font-medium"
      />
      <p id="f-cprImage-hint" className="mt-1 text-sm text-ink-soft">
        {hint ?? dict.join.cpr_image_hint}
      </p>
      <p aria-live="polite" className="mt-1 text-sm text-ink-soft">
        {busy && dict.join.cpr_image_processing}
      </p>
      {value && url && (
        <div className="mt-2 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="max-h-56 rounded-xl border border-line" />
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => inputRef.current?.click()}>
              {dict.join.cpr_image_change}
            </button>
            <button type="button" className={btn} onClick={remove}>
              {dict.join.cpr_image_remove}
            </button>
          </div>
        </div>
      )}
      {shownError && (
        <p id="f-cprImage-error" className="mt-1 text-sm text-crimson">
          {shownError}
        </p>
      )}
    </div>
  );
}
