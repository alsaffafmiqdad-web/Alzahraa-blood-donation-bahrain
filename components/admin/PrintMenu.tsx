"use client";

import { ChevronDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Props = {
  cardHref: string;
  certificateHref: string;
  size?: "sm" | "default";
  /** aria-label for the trigger. */
  label?: string;
};

/** Print dropdown: the donation card (registration form) or the donation certificate PDF. */
export function PrintMenu({ cardHref, certificateHref, size = "default", label }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size} aria-label={label}>
          <Printer className="size-4" aria-hidden="true" />
          Print
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={cardHref} target="_blank" rel="noopener noreferrer">
            Donation card
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={certificateHref} target="_blank" rel="noopener noreferrer">
            Donation certificate
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
