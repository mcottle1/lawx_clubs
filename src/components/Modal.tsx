import { useEffect, useRef, type ReactNode } from 'react'

/** Accessible modal built on the native <dialog> (focus trap + Esc to close for free). */
export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      aria-labelledby="modal-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 id="modal-title" className="font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
      </div>
      <div className="p-5">{open && children}</div>
    </dialog>
  )
}
