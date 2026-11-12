// Small shared UI primitives. Colors come from the accent tokens in index.css.
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-60',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-60',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-60',
  ghost: 'text-accent-700 hover:bg-accent-50 disabled:opacity-60',
}
const buttonBase = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors'

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={cx(buttonBase, variants[variant], className)} {...props} />
}

export function ButtonLink({ variant = 'primary', className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />
}

export const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 ' +
  'focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:bg-slate-100'

/** Label + control + hint. `children` receives the generated id for the control. */
export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: ReactNode
  required?: boolean
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
        {required && <span className="text-red-700" aria-hidden> *</span>}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Alert({
  kind = 'error',
  className,
  children,
}: {
  kind?: 'error' | 'success' | 'info' | 'warning'
  className?: string
  children: ReactNode
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-accent-100 bg-accent-50 text-accent-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', styles, className)}>
      {children}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg border border-slate-200 bg-white p-5 shadow-sm', className)}>{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="py-12 text-center text-sm text-slate-500">
      {label}
    </p>
  )
}
