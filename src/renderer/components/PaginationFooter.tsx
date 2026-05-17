import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "./ui/pagination";
import type { MouseEvent } from "react";

interface PaginationFooterProps {
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function PaginationFooter({ page, pageSize, total, itemLabel, onPageChange }: PaginationFooterProps) {
  if (total <= pageSize) return null;

  const pageCount = pageCountFor(total, pageSize);
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(total, currentPage * pageSize);
  const previousDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= pageCount;

  const goToPage = (nextPage: number) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (nextPage < 1 || nextPage > pageCount || nextPage === currentPage) return;
    onPageChange(nextPage);
  };

  const disabledClass = "pointer-events-none opacity-45";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background-100 px-3 py-2">
      <div className="text-xs text-muted-foreground">
        Showing {compactRange(start, end)} of {compactNumber(total)} {itemLabel}
      </div>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={previousDisabled}
              tabIndex={previousDisabled ? -1 : undefined}
              className={previousDisabled ? disabledClass : undefined}
              onClick={goToPage(currentPage - 1)}
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#" isActive onClick={(event) => event.preventDefault()} className="min-w-16 px-2 font-mono text-xs">
              {currentPage} / {pageCount}
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={nextDisabled}
              tabIndex={nextDisabled ? -1 : undefined}
              className={nextDisabled ? disabledClass : undefined}
              onClick={goToPage(currentPage + 1)}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

function compactRange(start: number, end: number): string {
  return `${compactNumber(start)}-${compactNumber(end)}`;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
}
