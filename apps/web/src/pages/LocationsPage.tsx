import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { errorMessage } from '../lib/errors.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { locationPath, locationsAsTree } from '../lib/locations.js';
import type { LocationRow } from '../lib/api.js';
import { useT } from '../i18n/index.js';

const ROOT_DROP_ID = '__root__';

export function LocationsPage() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const { register, handleSubmit, reset, formState } = useForm<{ name: string; parentId: string }>({
    defaultValues: { name: '', parentId: '' },
  });

  const create = useMutation({
    mutationFn: (v: { name: string; parentId: string }) =>
      apiClient.locations.create({ name: v.name, parentId: v.parentId || null }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['locations'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.locations.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });

  const reparent = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      apiClient.locations.update(id, { parentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
    // Errors (e.g. would-create-a-cycle) surface via the global toast handler.
  });

  const rows = list.data?.items ?? [];
  const tree = locationsAsTree(rows);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRow = useMemo(() => rows.find((r) => r.id === activeId) ?? null, [rows, activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const draggedId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    if (overId === draggedId) return;
    const newParent = overId === ROOT_DROP_ID ? null : overId;
    const dragged = rows.find((r) => r.id === draggedId);
    if (!dragged) return;
    if ((dragged.parentId ?? null) === newParent) return;
    reparent.mutate({ id: draggedId, parentId: newParent });
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.locations.title}</h1>
        <Link to="/assets/import?kind=locations" className="text-sm text-blue-600 hover:underline">
          {t.locations.importCsv}
        </Link>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">{t.locations.newLocation}</h2>
        <form
          className="flex flex-wrap gap-2 items-end"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <div className="flex-1 min-w-[200px]">
            <Field label={t.locations.nameLabel} required error={formState.errors.name?.message}>
              <Input
                {...register('name', { required: t.locations.nameRequired })}
                placeholder={t.locations.namePlaceholder}
              />
            </Field>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Field label={t.locations.parentLabel}>
              <LocationSelect
                locations={list.data?.items ?? []}
                placeholder={t.locations.parentPlaceholder}
                {...register('parentId')}
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t.common.add}
          </Button>
        </form>
        {create.error && <p className="text-sm text-red-600 mt-2">{errorMessage(create.error)}</p>}
      </Card>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <Card className="p-0 overflow-hidden">
          <RootDropZone />
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {tree.length === 0 && (
              <li className="p-3 text-sm text-slate-500">{t.locations.empty}</li>
            )}
            {tree.map(({ row, depth }) => (
              <LocationRowItem
                key={row.id}
                row={row}
                depth={depth}
                allRows={rows}
                onDelete={async () => {
                  if (
                    await confirm({
                      title: t.locations.deleteTitle(row.name),
                      message: t.locations.deleteMessage,
                      confirmLabel: t.common.delete,
                      danger: true,
                    })
                  ) {
                    remove.mutate(row.id, {
                      onSuccess: () => toast.success(t.locations.deleted),
                    });
                  }
                }}
                onReparent={(parentId) => reparent.mutate({ id: row.id, parentId })}
              />
            ))}
          </ul>
        </Card>
        <DragOverlay>
          {activeRow ? (
            <div className="rounded border border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600 px-3 py-2 text-sm shadow">
              {activeRow.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t.locations.tip}</p>
    </section>
  );
}

function RootDropZone() {
  const t = useT();
  const { isOver, setNodeRef } = useDroppable({ id: ROOT_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={`px-3 py-2 text-xs border-b border-slate-200 dark:border-slate-700 ${
        isOver ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-slate-50 dark:bg-slate-900/40'
      }`}
    >
      {t.locations.rootDrop}
    </div>
  );
}

function LocationRowItem({
  row,
  depth,
  allRows,
  onDelete,
  onReparent,
}: {
  row: LocationRow;
  depth: number;
  allRows: LocationRow[];
  onDelete: () => void;
  onReparent: (parentId: string | null) => void;
}) {
  const t = useT();
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: row.id,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: row.id });

  function setBothRefs(el: HTMLLIElement | null) {
    setDragRef(el);
    setDropRef(el);
  }

  return (
    <li
      ref={setBothRefs}
      className={`flex items-center justify-between gap-2 p-2 ${
        isOver ? 'bg-emerald-50 dark:bg-emerald-900/30' : ''
      } ${isDragging ? 'opacity-40' : ''}`}
      style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 px-1"
        aria-label={t.locations.dragLabel(row.name)}
        title={t.locations.dragTitle}
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {depth > 0 && <span className="text-slate-400 mr-1">└</span>}
          {row.name}
        </p>
        {depth > 0 && <p className="text-xs text-slate-500">{locationPath(allRows, row.id)}</p>}
      </div>
      <div className="flex items-center gap-2">
        <LocationSelect
          locations={allRows.filter((l) => l.id !== row.id)}
          placeholder={t.locations.moveUnderPlaceholder}
          value={row.parentId ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value === (row.parentId ?? '')) return;
            onReparent(value || null);
          }}
          className="text-xs"
        />
        <Button variant="ghost" className="text-red-600 text-xs" onClick={onDelete}>
          {t.common.delete}
        </Button>
      </div>
    </li>
  );
}
