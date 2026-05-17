import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/renderer/components/ui/button";
import { Calendar } from "@/renderer/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/renderer/components/ui/popover";
import { cn } from "@/renderer/lib/utils";

export function DatePicker({
  date,
  placeholder = "Pick a date",
  disabled,
  className,
  onDateChange
}: {
  date?: Date;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onDateChange: (date?: Date) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("justify-start text-left font-normal", !date && "text-muted-foreground", className)}
        >
          <CalendarIcon className="mr-2 size-4" />
          {date ? date.toLocaleDateString() : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onDateChange} />
      </PopoverContent>
    </Popover>
  );
}
