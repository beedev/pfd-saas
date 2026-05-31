import React, { useState } from 'react';
import { Button } from '../primitives/Button';

export interface Column<T extends object> {
  key: keyof T & string;
  header: React.ReactNode;
  render?: (value: unknown, row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

export interface DataTableProps<T extends object> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
  pagination?: { page: number; pageSize: number; total: number; onChange: (page: number) => void };
}

/**
 * DataTable renders a table on md+ and a stacked card layout on <md.
 * Same sort, same pagination, same empty/loading states. The first
 * column is used as the card title; subsequent columns become
 * label/value rows inside the card. Sorting controls are hidden on
 * mobile (low value on small screens; tap the column header in a
 * future iteration if needed).
 */
export function DataTable<T extends object>({
  columns, data, onRowClick, emptyMessage = 'No data found', loading, pagination,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = String((a as Record<string, unknown>)[sortKey] ?? '');
        const bv = String((b as Record<string, unknown>)[sortKey] ?? '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      })
    : data;

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 0;

  const renderCell = (col: Column<T>, row: T): React.ReactNode => {
    const value = (row as Record<string, unknown>)[col.key];
    return col.render ? col.render(value, row) : String(value ?? '');
  };

  return (
    <div className="overflow-hidden rounded-[var(--dxp-radius)] border border-[var(--dxp-border)] bg-[var(--dxp-surface)]">
      {/* Desktop / tablet — table layout */}
      <table className="hidden md:table min-w-full divide-y divide-[var(--dxp-border)]">
        <thead className="bg-[var(--dxp-border-light)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-[var(--dxp-density-px)] py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--dxp-text-secondary)] ${col.sortable ? 'cursor-pointer select-none hover:text-[var(--dxp-text)]' : ''}`}
                style={col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                {col.header}
                {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dxp-border-light)]">
          {loading ? (
            <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--dxp-density-text)] text-[var(--dxp-text-muted)]">Loading...</td></tr>
          ) : sorted.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--dxp-density-text)] text-[var(--dxp-text-muted)]">{emptyMessage}</td></tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={i}
                className={`${onRowClick ? 'cursor-pointer hover:bg-[var(--dxp-border-light)]' : ''} transition-colors`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-[var(--dxp-density-px)] py-[var(--dxp-density-py)] text-[var(--dxp-density-text)] text-[var(--dxp-text)]">
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Mobile — stacked card layout. First column = card title,
          subsequent columns = label/value rows. */}
      <div className="md:hidden divide-y divide-[var(--dxp-border-light)]">
        {loading ? (
          <div className="px-4 py-8 text-center text-[var(--dxp-text-muted)]">Loading...</div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-[var(--dxp-text-muted)]">{emptyMessage}</div>
        ) : (
          sorted.map((row, i) => (
            <div
              key={i}
              className={`px-4 py-3 ${onRowClick ? 'cursor-pointer active:bg-[var(--dxp-border-light)]' : ''} transition-colors`}
              onClick={() => onRowClick?.(row)}
              role={onRowClick ? 'button' : undefined}
            >
              {columns.map((col, idx) => {
                const cellContent = renderCell(col, row);
                if (idx === 0) {
                  return (
                    <div key={col.key} className="text-base font-semibold text-[var(--dxp-text)] mb-2">
                      {cellContent}
                    </div>
                  );
                }
                return (
                  <div
                    key={col.key}
                    className="flex items-baseline justify-between gap-3 text-sm py-0.5"
                  >
                    <span className="text-xs uppercase tracking-wider text-[var(--dxp-text-secondary)] flex-shrink-0">
                      {col.header}
                    </span>
                    <span className="text-[var(--dxp-text)] text-right break-words min-w-0">
                      {cellContent}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--dxp-border)] bg-[var(--dxp-border-light)] px-4 py-3">
          <span className="text-xs md:text-sm text-[var(--dxp-text-secondary)]">
            Page {pagination.page} of {totalPages} <span className="hidden sm:inline">({pagination.total} total)</span>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={pagination.page <= 1} onClick={() => pagination.onChange(pagination.page - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={pagination.page >= totalPages} onClick={() => pagination.onChange(pagination.page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
