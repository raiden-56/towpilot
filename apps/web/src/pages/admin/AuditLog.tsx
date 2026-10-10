import { Fragment, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, Button, Card, Collapse, IconButton, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { api } from '@/api/client';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/common';
import { dateTime } from '@/lib/format';
import type { AuditRow } from './biz/types';
import { FilterBar, mono, useDebounced } from './biz/shared';

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  invoice: (id) => `/admin/finance/invoices/${id}`,
  booking: (id) => `/admin/bookings/${id}`,
  fleet_account: (id) => `/admin/accounts/${id}`,
  tow_truck: (id) => `/admin/fleet/${id}`,
};

type Flat = Record<string, unknown>;
function flatten(v: unknown, prefix = '', out: Flat = {}): Flat {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Flat);
    if (!entries.length && prefix) out[prefix] = {};
    for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out[prefix] = v;
  else out['(value)'] = v;
  return out;
}
const show = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const [mode, setMode] = useState<'changes' | 'all' | 'raw'>('changes');
  const rows = useMemo(() => {
    const b = before == null ? {} : flatten(before);
    const a = after == null ? {} : flatten(after);
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    return keys.map((k) => ({ k, b: b[k], a: a[k], changed: JSON.stringify(b[k]) !== JSON.stringify(a[k]) }));
  }, [before, after]);
  const visible = mode === 'changes' && before != null && after != null ? rows.filter((r) => r.changed) : rows;
  if (before == null && after == null) return <Typography variant="body2" color="text.secondary">No before/after data recorded for this event.</Typography>;
  return (
    <Box>
      <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)} sx={{ mb: 1 }}>
        <ToggleButton value="changes" disabled={before == null || after == null}>Changed fields</ToggleButton>
        <ToggleButton value="all">All fields</ToggleButton>
        <ToggleButton value="raw">Raw JSON</ToggleButton>
      </ToggleButtonGroup>
      {mode === 'raw' ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          {(['before', 'after'] as const).map((k) => (
            <Box key={k} sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>{k}</Typography>
              <Box component="pre" sx={{ ...mono, fontSize: 12, m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflow: 'auto', maxHeight: 360 }}>{JSON.stringify(k === 'before' ? before : after, null, 2) ?? 'null'}</Box>
            </Box>
          ))}
        </Stack>
      ) : visible.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No field differences.</Typography>
      ) : (
        <TableContainer sx={{ overflowX: 'auto', maxHeight: 420 }}>
          <Table size="small" stickyHeader sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow>
                <TableCell>Field</TableCell>
                <TableCell>Before</TableCell>
                <TableCell>After</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.k}>
                  <TableCell sx={{ ...mono, fontSize: 12, verticalAlign: 'top' }}>{r.k}</TableCell>
                  <TableCell sx={{ ...mono, fontSize: 12, verticalAlign: 'top', wordBreak: 'break-word', bgcolor: r.changed && r.b !== undefined ? 'rgba(220,38,38,0.08)' : undefined, textDecoration: r.changed && r.b !== undefined ? 'line-through' : undefined, color: r.changed ? 'error.main' : 'text.secondary' }}>{show(r.b)}</TableCell>
                  <TableCell sx={{ ...mono, fontSize: 12, verticalAlign: 'top', wordBreak: 'break-word', bgcolor: r.changed && r.a !== undefined ? 'rgba(22,163,74,0.10)' : undefined, color: r.changed ? 'success.main' : 'text.secondary' }}>{show(r.a)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default function AuditLog() {
  const [sp, setSp] = useSearchParams();
  const [entityType, setEntityType] = useState(sp.get('entityType') ?? '');
  const [entityId, setEntityId] = useState(sp.get('entityId') ?? '');
  const [action, setAction] = useState(sp.get('action') ?? '');
  const [actor, setActor] = useState(sp.get('actorUserId') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [open, setOpen] = useState<string | null>(null);
  const fKey = useDebounced(JSON.stringify({ entityType: entityType.trim(), entityId: entityId.trim(), action: action.trim(), actorUserId: actor.trim() }));
  const f = useMemo(() => JSON.parse(fKey) as { entityType: string; entityId: string; action: string; actorUserId: string }, [fKey]);
  const list = useQuery({
    queryKey: ['admin', 'audit', f, page, pageSize],
    queryFn: () => api.page<AuditRow>('/admin/system/audit-logs', { entityType: f.entityType || undefined, entityId: f.entityId || undefined, action: f.action || undefined, actorUserId: f.actorUserId || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  });
  const upd = (setter: (v: string) => void, key: string) => (v: string) => {
    setter(v);
    setPage(1);
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (v) n.set(key, v);
      else n.delete(key);
      return n;
    }, { replace: true });
  };
  const filterBy = (key: 'entityType' | 'entityId' | 'actorUserId', v: string) => {
    const map = { entityType: setEntityType, entityId: setEntityId, actorUserId: setActor };
    upd(map[key], key)(v);
  };
  const anyFilter = entityType || entityId || action || actor;

  return (
    <Box>
      <PageHeader title="Audit log" subtitle="Tamper-evident record of sign-ins, configuration, financial and operational changes" />
      <FilterBar actions={anyFilter && <Button onClick={() => { ['entityType', 'entityId', 'action', 'actorUserId'].forEach((k) => upd(() => undefined, k)('')); setEntityType(''); setEntityId(''); setAction(''); setActor(''); }}>Clear filters</Button>}>
        <TextField size="small" label="Entity type" placeholder="e.g. invoice, rate_card" value={entityType} onChange={(e) => upd(setEntityType, 'entityType')(e.target.value)} />
        <TextField size="small" label="Entity id" value={entityId} onChange={(e) => upd(setEntityId, 'entityId')(e.target.value)} />
        <TextField size="small" label="Action contains" placeholder="e.g. refund, settings" value={action} onChange={(e) => upd(setAction, 'action')(e.target.value)} />
        <TextField size="small" label="Actor user id" value={actor} onChange={(e) => upd(setActor, 'actorUserId')(e.target.value)} />
      </FilterBar>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <LoadingBlock rows={8} height={44} />
      ) : !list.data?.data.length ? (
        <Card><EmptyState title="No audit entries match" body={anyFilter ? 'Try broadening the filters.' : undefined} /></Card>
      ) : (
        <Card>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 40 }} />
                  <TableCell>Time</TableCell>
                  <TableCell>Actor</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Entity</TableCell>
                  <TableCell>IP / request</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.data.data.map((r) => {
                  const isOpen = open === r.id;
                  const link = r.entityId && ENTITY_LINKS[r.entityType]?.(r.entityId);
                  return (
                    <Fragment key={r.id}>
                      <TableRow hover onClick={() => setOpen(isOpen ? null : r.id)} sx={{ cursor: 'pointer', '& > td': { borderBottom: isOpen ? 0 : undefined } }}>
                        <TableCell>
                          <IconButton size="small" aria-label={isOpen ? 'Hide details' : 'Show details'} aria-expanded={isOpen}>
                            {isOpen ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                          </IconButton>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(r.createdAt)}</TableCell>
                        <TableCell>
                          {r.actorUserId ? (
                            <Link component="button" type="button" onClick={(e: React.MouseEvent) => { e.stopPropagation(); filterBy('actorUserId', r.actorUserId!); }} sx={{ textAlign: 'left' }}>
                              {r.actorName ?? 'Unknown user'}
                            </Link>
                          ) : (
                            <Typography variant="body2" color="text.secondary">{r.actorName ?? 'System'}</Typography>
                          )}
                        </TableCell>
                        <TableCell><Typography variant="body2" sx={{ ...mono, fontSize: 12, fontWeight: 600 }}>{r.action}</Typography></TableCell>
                        <TableCell>
                          <Link component="button" type="button" onClick={(e: React.MouseEvent) => { e.stopPropagation(); filterBy('entityType', r.entityType); }}>{r.entityType}</Link>
                          {r.entityId && (
                            <Typography variant="caption" display="block" sx={{ ...mono, fontSize: 11 }}>
                              {link ? <Link component={RouterLink} to={link} onClick={(e) => e.stopPropagation()}>{r.entityId}</Link> : r.entityId}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell><Typography variant="caption" sx={{ ...mono, fontSize: 11 }} color="text.secondary">{r.ip ?? '—'}</Typography></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ py: 0, borderBottom: isOpen ? undefined : 0 }}>
                          <Collapse in={isOpen} unmountOnExit>
                            <Box sx={{ py: 1.5 }}>
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, ...mono, fontSize: 11 }}>
                                Event {r.id}{r.requestId ? ` · request ${r.requestId}` : ''}{r.actorUserId ? ` · actor ${r.actorUserId}` : ''}
                                {r.entityId && <> · <Link component="button" type="button" onClick={() => filterBy('entityId', r.entityId!)}>history of this entity</Link></>}
                              </Typography>
                              <DiffView before={r.before} after={r.after} />
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={list.data.meta.total} page={page - 1} rowsPerPage={pageSize} onPageChange={(_, p) => setPage(p + 1)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} rowsPerPageOptions={[20, 50, 100]} />
        </Card>
      )}
    </Box>
  );
}
