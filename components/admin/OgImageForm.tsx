"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { removeOgImage, updateOgImage } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function OgImageForm({ currentUrl }: { currentUrl: string | null }) {
  const [state, action, pending] = useActionState(updateOgImage, initialFormState);
  const [removing, startRemove] = useTransition();
  return (
    <div className="max-w-sm space-y-4">
      <div className="space-y-2">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt="Current link preview" className="w-full rounded-md border border-line" />
        ) : (
          <>
            <p className="text-sm text-ink-soft">Using the default image</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/og-default.jpg" alt="Default link preview" className="w-full rounded-md border border-line" />
          </>
        )}
      </div>
      <form action={action} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="og_image">New image</Label>
          <input
            id="og_image"
            name="og_image"
            type="file"
            accept="image/jpeg,image/png"
            required
            aria-describedby="og_image-hint"
            className="block w-full text-sm"
          />
          <p id="og_image-hint" className="text-sm text-ink-soft">
            JPG or PNG, 1200 by 630 pixels recommended, up to 900 KB.
          </p>
        </div>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
        <Button type="submit" disabled={pending || removing}>
          {pending ? "Uploading..." : "Upload image"}
        </Button>
      </form>
      {currentUrl && (
        <Button
          type="button"
          variant="outline"
          disabled={pending || removing}
          onClick={() =>
            startRemove(async () => {
              const res = await removeOgImage();
              if (res.ok) toast.success("Link preview image removed");
              else toast.error(res.error);
            })
          }
        >
          Remove image
        </Button>
      )}
    </div>
  );
}
