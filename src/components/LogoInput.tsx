import { useEffect, useState } from 'react'
import { validateImage } from '../lib/storage'
import { Field, inputClass } from './ui'

/** File picker with type/size validation and a preview. */
export default function LogoInput({
  label = 'Logo or photo',
  onChange,
  currentUrl,
}: {
  label?: string
  onChange: (file: File | null) => void
  currentUrl?: string | null
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  return (
    <Field label={label} hint="PNG, JPEG, WebP or GIF, up to 10 MB.">
      {(id) => (
        <div className="flex items-center gap-4">
          {(preview || currentUrl) && (
            <img src={preview ?? currentUrl ?? ''} alt="" className="h-16 w-16 rounded-md border border-slate-200 object-cover" />
          )}
          <div className="flex-1">
            <input
              id={id}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className={inputClass}
              aria-invalid={!!error}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                const problem = file ? validateImage(file) : null
                setError(problem)
                setPreview(file && !problem ? URL.createObjectURL(file) : null)
                onChange(file && !problem ? file : null)
                if (problem) e.target.value = ''
              }}
            />
            {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
          </div>
        </div>
      )}
    </Field>
  )
}
