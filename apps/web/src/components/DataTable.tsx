import type { ReactNode } from 'react';
import { Box, Card, CardActionArea, CardContent, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Typography, useMediaQuery, useTheme } from '@mui/material';
import { EmptyState, ErrorState, LoadingBlock } from './common';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Hide this column in the mobile card view. */
  hideOnMobile?: boolean;
  /** Use as the card title on mobile. */
  primary?: boolean;
}

export interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  page?: number; // 1-based
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  dense?: boolean;
}

/** Responsive table: a real table on desktop/tablet, stacked cards on phones. Server-side pagination. */
export function DataTable<T>({ rows, columns, rowKey, loading, error, onRetry, onRowClick, emptyTitle = 'Nothing here yet', emptyBody, page, pageSize = 20, total, onPageChange, onPageSizeChange, dense }: DataTableProps<T>) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingBlock rows={6} />;
  if (!rows?.length) return <EmptyState title={emptyTitle} body={emptyBody} />;

  const pagination =
    page != null && total != null && onPageChange ? (
      <TablePagination
        component="div"
        count={total}
        page={page - 1}
        rowsPerPage={pageSize}
        onPageChange={(_, p) => onPageChange(p + 1)}
        onRowsPerPageChange={onPageSizeChange ? (e) => onPageSizeChange(Number(e.target.value)) : undefined}
        rowsPerPageOptions={onPageSizeChange ? [10, 20, 50, 100] : [pageSize]}
      />
    ) : null;

  if (mobile) {
    const primary = columns.find((c) => c.primary) ?? columns[0]!;
    return (
      <Box>
        <Stack spacing={1.25}>
          {rows.map((r) => (
            <Card key={rowKey(r)}>
              {/* Only the title area is the click target, so buttons inside cells are never nested in a button. */}
              {onRowClick ? (
                <CardActionArea onClick={() => onRowClick(r)} sx={{ px: 2, pt: 1.5, pb: 0.75 }}>
                  <Box sx={{ fontWeight: 700 }}>{primary.render(r)}</Box>
                </CardActionArea>
              ) : (
                <Box sx={{ fontWeight: 700, px: 2, pt: 1.5, pb: 0.75 }}>{primary.render(r)}</Box>
              )}
              <CardContent sx={{ pt: 0, pb: 1.5, '&:last-child': { pb: 1.5 } }}>
                  {columns
                    .filter((c) => c !== primary && !c.hideOnMobile)
                    .map((c) => (
                      <Stack key={c.key} direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.25 }}>
                        <Typography variant="caption" color="text.secondary">
                          {c.header}
                        </Typography>
                        <Box sx={{ fontSize: 14, textAlign: 'right' }}>{c.render(r)}</Box>
                      </Stack>
                    ))}
              </CardContent>
            </Card>
          ))}
        </Stack>
        {pagination}
      </Box>
    );
  }

  return (
    <Card>
      <TableContainer>
        <Table size={dense ? 'small' : 'medium'}>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ width: c.width }}>
                  {c.header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={rowKey(r)} hover={!!onRowClick} onClick={() => onRowClick?.(r)} sx={{ cursor: onRowClick ? 'pointer' : undefined, '&:last-child td': { borderBottom: 0 } }}>
                {columns.map((c) => (
                  <TableCell key={c.key} align={c.align}>
                    {c.render(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}
    </Card>
  );
}
