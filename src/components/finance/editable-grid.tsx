'use client';

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { parseAmount, formatCompact } from '@/lib/finance/amount';

export interface GridColumn {
  id: string;
  header: string;
  subHeader?: string;
  width?: number;
  editable?: boolean;
  type?: 'amount' | 'text' | 'readonly';
  className?: string;
}

export interface GridRow {
  id: string;
  label: string;
  type?: 'header' | 'data' | 'total' | 'separator';
  className?: string;
}

export interface CellValue {
  rowId: string;
  columnId: string;
  value: number | string | null;
  notes?: string;
  status?: 'paid' | 'unpaid' | 'partial';
}

export interface EditableGridProps {
  columns: GridColumn[];
  rows: GridRow[];
  data: Map<string, CellValue>; // key: `${rowId}-${columnId}`
  onCellChange: (rowId: string, columnId: string, value: number | string | null) => void;
  onCellBlur?: (rowId: string, columnId: string) => void;
  className?: string;
  stickyFirstColumn?: boolean;
  stickyHeader?: boolean;
}

function getCellKey(rowId: string, columnId: string): string {
  return `${rowId}-${columnId}`;
}

export function EditableGrid({
  columns,
  rows,
  data,
  onCellChange,
  onCellBlur,
  className,
  stickyFirstColumn = true,
  stickyHeader = true,
}: EditableGridProps) {
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const startEditing = useCallback((rowId: string, columnId: string, currentValue: number | string | null) => {
    const column = columns.find(c => c.id === columnId);
    if (!column?.editable) return;

    const cellKey = getCellKey(rowId, columnId);
    setEditingCell(cellKey);

    // Format the value for editing
    if (column.type === 'amount') {
      if (currentValue === null || currentValue === 0) {
        setEditValue('');
      } else {
        setEditValue(formatCompact(currentValue as number).replace('-', ''));
      }
    } else {
      setEditValue(currentValue?.toString() || '');
    }
  }, [columns]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;

    // Parse the cell key - format is "rowId-columnId" where both can contain dashes
    // Find the column by checking which column ID the editingCell ends with
    let foundRowId = '';
    let foundColumnId = '';

    for (const col of columns) {
      if (editingCell.endsWith('-' + col.id)) {
        foundColumnId = col.id;
        foundRowId = editingCell.slice(0, -(col.id.length + 1)); // Remove "-columnId" from end
        break;
      }
    }

    if (!foundRowId || !foundColumnId) return;

    const column = columns.find(c => c.id === foundColumnId);

    if (column?.type === 'amount') {
      const paisa = parseAmount(editValue);
      onCellChange(foundRowId, foundColumnId, paisa);
    } else {
      onCellChange(foundRowId, foundColumnId, editValue || null);
    }

    if (onCellBlur) {
      onCellBlur(foundRowId, foundColumnId);
    }

    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, columns, onCellChange, onCellBlur]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const navigateToCell = useCallback((rowId: string, columnId: string, direction: 'up' | 'down' | 'left' | 'right') => {
    const rowIndex = rows.findIndex(r => r.id === rowId);
    const colIndex = columns.findIndex(c => c.id === columnId);

    let newRowIndex = rowIndex;
    let newColIndex = colIndex;

    switch (direction) {
      case 'up':
        newRowIndex = Math.max(0, rowIndex - 1);
        break;
      case 'down':
        newRowIndex = Math.min(rows.length - 1, rowIndex + 1);
        break;
      case 'left':
        newColIndex = Math.max(0, colIndex - 1);
        break;
      case 'right':
        newColIndex = Math.min(columns.length - 1, colIndex + 1);
        break;
    }

    // Skip non-editable cells and non-data rows
    const newRow = rows[newRowIndex];
    const newCol = columns[newColIndex];

    if (newRow?.type === 'data' && newCol?.editable) {
      const cellValue = data.get(getCellKey(newRow.id, newCol.id));
      startEditing(newRow.id, newCol.id, cellValue?.value ?? null);
    }
  }, [rows, columns, data, startEditing]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!editingCell) return;

    // Parse the cell key properly
    let rowId = '';
    let columnId = '';
    for (const col of columns) {
      if (editingCell.endsWith('-' + col.id)) {
        columnId = col.id;
        rowId = editingCell.slice(0, -(col.id.length + 1));
        break;
      }
    }

    if (!rowId || !columnId) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        commitEdit();
        // Move down
        navigateToCell(rowId, columnId, 'down');
        break;
      case 'Tab':
        e.preventDefault();
        commitEdit();
        // Move right (or left with shift)
        navigateToCell(rowId, columnId, e.shiftKey ? 'left' : 'right');
        break;
      case 'Escape':
        e.preventDefault();
        cancelEdit();
        break;
      case 'ArrowUp':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          commitEdit();
          navigateToCell(rowId, columnId, 'up');
        }
        break;
      case 'ArrowDown':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          commitEdit();
          navigateToCell(rowId, columnId, 'down');
        }
        break;
    }
  }, [editingCell, columns, commitEdit, cancelEdit, navigateToCell]);

  const renderCell = (row: GridRow, column: GridColumn) => {
    const cellKey = getCellKey(row.id, column.id);
    const cellData = data.get(cellKey);
    const value = cellData?.value ?? null;
    const isEditing = editingCell === cellKey;

    // Handle header/separator/total rows
    if (row.type === 'header' || row.type === 'separator') {
      return (
        <td
          key={cellKey}
          className={cn(
            'px-2 py-1 text-xs font-semibold bg-gray-100 border-b border-gray-200',
            row.className
          )}
        />
      );
    }

    if (row.type === 'total') {
      return (
        <td
          key={cellKey}
          className={cn(
            'px-2 py-1 text-xs font-bold bg-gray-50 border-t-2 border-gray-300',
            column.type === 'amount' ? 'text-right font-mono' : '',
            column.className
          )}
        >
          {column.type === 'amount' ? formatCompact(value as number) : value}
        </td>
      );
    }

    // Editable cell
    if (column.editable && isEditing) {
      return (
        <td
          key={cellKey}
          className={cn(
            'px-0 py-0 border-b border-gray-200',
            column.className
          )}
        >
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className={cn(
              'w-full h-full px-2 py-1 text-xs border-2 border-blue-500 outline-none',
              column.type === 'amount' ? 'text-right font-mono' : ''
            )}
          />
        </td>
      );
    }

    // Display cell
    const displayValue = column.type === 'amount'
      ? formatCompact(value as number)
      : value || '-';

    const statusClass =
      cellData?.status === 'paid'
        ? 'bg-emerald-100 text-emerald-900 font-semibold border-l-4 border-l-emerald-500'
        : cellData?.status === 'unpaid'
          ? 'bg-amber-100 text-amber-900 font-semibold border-l-4 border-l-amber-500'
          : cellData?.status === 'partial'
            ? 'bg-orange-100 text-orange-900 font-semibold border-l-4 border-l-orange-500'
            : '';

    return (
      <td
        key={cellKey}
        onClick={() => column.editable && startEditing(row.id, column.id, value)}
        title={
          cellData?.status === 'paid'
            ? 'Statement paid'
            : cellData?.status === 'unpaid'
              ? 'Statement recorded — not yet paid'
              : cellData?.status === 'partial'
                ? 'Statement partially paid'
                : undefined
        }
        className={cn(
          'px-2 py-1 text-xs border-b border-gray-200 cursor-pointer hover:bg-blue-50 transition-colors',
          column.type === 'amount' ? 'text-right font-mono' : '',
          column.editable ? 'cursor-cell' : 'cursor-default',
          value && (value as number) < 0 ? 'text-red-600' : '',
          statusClass,
          column.className
        )}
      >
        {displayValue}
      </td>
    );
  };

  return (
    <div
      ref={gridRef}
      className={cn('overflow-auto border border-gray-300 rounded-lg', className)}
    >
      <table className="w-full border-collapse text-sm">
        <thead className={cn(stickyHeader ? 'sticky top-0 z-10' : '')}>
          <tr className="bg-gray-800 text-white">
            {columns.map((column, idx) => (
              <th
                key={column.id}
                className={cn(
                  'px-2 py-2 text-xs font-semibold text-left border-b border-gray-600',
                  stickyFirstColumn && idx === 0 ? 'sticky left-0 z-20 bg-gray-800' : '',
                  column.type === 'amount' ? 'text-right' : '',
                  column.className
                )}
                style={{ width: column.width ? `${column.width}px` : 'auto', minWidth: column.width ? `${column.width}px` : '80px' }}
              >
                <div>{column.header}</div>
                {column.subHeader && (
                  <div className="text-[10px] font-normal text-gray-400">{column.subHeader}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                row.type === 'header' ? 'bg-gray-100 font-semibold' : '',
                row.type === 'total' ? 'bg-gray-50 font-bold' : '',
                row.type === 'separator' ? 'h-2 bg-gray-200' : '',
                'hover:bg-gray-50'
              )}
            >
              {/* First column (label) */}
              <td
                className={cn(
                  'px-2 py-1 text-xs font-medium border-b border-gray-200 bg-white',
                  stickyFirstColumn ? 'sticky left-0 z-10' : '',
                  row.type === 'header' ? 'bg-gray-100 font-semibold text-gray-700' : '',
                  row.type === 'total' ? 'bg-gray-50 font-bold' : '',
                  row.className
                )}
              >
                {row.label}
              </td>
              {/* Data columns */}
              {columns.slice(1).map((column) => renderCell(row, column))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
