import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatDay, todayIso } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import type { Todo } from '../../../lib/types'
import { Alert, Button, Card, inputClass } from '../../../components/ui'

export default function TodoList({ clubId, todos, onChange }: { clubId: string; todos: Todo[]; onChange: () => void | Promise<void> }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optimistic check/uncheck so the box responds instantly.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  const items = todos.map((t) => (t.id in overrides ? { ...t, done: overrides[t.id] } : t))
  const open = items.filter((t) => !t.done)
  const done = items.filter((t) => t.done)
  const today = todayIso()

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const { error } = await supabase.from('todos').insert({ club_id: clubId, title: title.trim(), due_on: due || null })
    if (error) return setError(error.message)
    setTitle('')
    setDue('')
    setError(null)
    onChange()
  }

  async function toggle(t: Todo) {
    setOverrides((o) => ({ ...o, [t.id]: !t.done }))
    const { error } = await supabase.from('todos').update({ done: !t.done }).eq('id', t.id)
    if (error) setError(error.message)
    await onChange()
    setOverrides((o) => {
      const rest = { ...o }
      delete rest[t.id]
      return rest
    })
  }

  async function remove(t: Todo) {
    await supabase.from('todos').delete().eq('id', t.id)
    onChange()
  }

  const row = (t: Todo) => {
    const overdue = !t.done && t.due_on && t.due_on < today
    return (
      <li key={t.id} className="flex items-start gap-3 py-2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-accent-600"
          checked={t.done}
          onChange={() => void toggle(t)}
          aria-label={`${t.done ? 'Mark not done' : 'Mark done'}: ${t.title}`}
        />
        <div className="min-w-0 flex-1 text-sm">
          <p className={t.done ? 'text-slate-400 line-through' : ''}>
            {t.related_event_id ? <Link to={`/club/events/${t.related_event_id}`} className="hover:underline">{t.title}</Link> : t.title}
          </p>
          <p className="text-xs text-slate-500">
            {t.due_on && <span className={overdue ? 'font-medium text-red-700' : ''}>{overdue ? 'Overdue · ' : 'Due '}{formatDay(t.due_on)}</span>}
            {t.source === 'system' && <span className="ml-1 rounded bg-slate-100 px-1">auto</span>}
          </p>
        </div>
        {t.source === 'manual' && (
          <button type="button" onClick={() => void remove(t)} className="text-xs text-slate-400 hover:text-red-700" aria-label={`Delete ${t.title}`}>
            ✕
          </button>
        )}
      </li>
    )
  }

  return (
    <Card>
      <h2 className="font-medium">To-do <span className="text-sm font-normal text-slate-500">({open.length})</span></h2>
      <form onSubmit={add} className="mt-3 space-y-2">
        <label className="sr-only" htmlFor="todo-title">New to-do</label>
        <input id="todo-title" className={inputClass} placeholder="Add a to-do…" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="todo-due">Due date (optional)</label>
          <input id="todo-due" type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
          <Button type="submit" disabled={!title.trim()}>Add</Button>
        </div>
      </form>
      {error && <Alert className="mt-2">{error}</Alert>}
      {open.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nothing to do. Nice!</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <>
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="mt-2 text-xs text-accent-700 hover:underline">
            {showDone ? 'Hide' : 'Show'} completed ({done.length})
          </button>
          {showDone && <ul className="divide-y divide-slate-100">{done.map(row)}</ul>}
        </>
      )}
    </Card>
  )
}
