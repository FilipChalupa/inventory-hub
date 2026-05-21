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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { locationPath, locationsAsTree } from '../lib/locations.js';
import type { LocationRow } from '../lib/api.js';

const ROOT_DROP_ID = '__root__';

export function LocationsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const { register, handleSubmit, reset } = useForm<{ name: string; parentId: string }>({
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
    onError: (err: Error) => {
      window.alert(err.message);
    },
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
        <h1 className="text-2xl font-bold">Lokace</h1>
        <Link
          to="/assets/import?kind=locations"
          className="text-sm text-blue-600 hover:underline"
        >
          Import CSV
        </Link>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">Nová lokace</h2>
        <form
          className="flex flex-wrap gap-2 items-end"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <div className="flex-1 min-w-[200px]">
            <Field label="Název">
              <Input {...register('name', { required: true })} placeholder="Kancelář 4.NP" />
            </Field>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Field label="Nadřazená">
              <LocationSelect
                locations={list.data?.items ?? []}
                placeholder="— žádná (kořenová) —"
                {...register('parentId')}
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending}>
            Přidat
          </Button>
        </form>
        {create.error && (
          <p className="text-sm text-red-600 mt-2">{(create.error as Error).message}</p>
        )}
      </Card>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <Card className="p-0 overflow-hidden">
          <RootDropZone />
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {tree.length === 0 && (
              <li className="p-3 text-sm text-slate-500">Žádné lokace.</li>
            )}
            {tree.map(({ row, depth }) => (
              <LocationRowItem
                key={row.id}
                row={row}
                depth={depth}
                allRows={rows}
                onDelete={() => {
                  if (confirm(`Smazat lokaci "${row.name}"?`)) remove.mutate(row.id);
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
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Tip: lokaci přetáhneš pro změnu nadřazené, nebo použij dropdown. Backend hlídá cykly.
      </p>
    </section>
  );
}

function RootDropZone() {
  const { isOver, setNodeRef } = useDroppable({ id: ROOT_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={`px-3 py-2 text-xs border-b border-slate-200 dark:border-slate-700 ${
        isOver ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-slate-50 dark:bg-slate-900/40'
      }`}
    >
      ⤴ pusť sem pro přesun do kořene
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
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
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
        aria-label={`Přetáhnout ${row.name}`}
        title="Přetáhnout"
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {depth > 0 && <span className="text-slate-400 mr-1">└</span>}
          {row.name}
        </p>
        {depth > 0 && (
          <p className="text-xs text-slate-500">{locationPath(allRows, row.id)}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <LocationSelect
          locations={allRows.filter((l) => l.id !== row.id)}
          placeholder="— přesunout pod —"
          value={row.parentId ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value === (row.parentId ?? '')) return;
            onReparent(value || null);
          }}
          className="text-xs"
        />
        <Button variant="ghost" className="text-red-600 text-xs" onClick={onDelete}>
          Smazat
        </Button>
      </div>
    </li>
  );
}
