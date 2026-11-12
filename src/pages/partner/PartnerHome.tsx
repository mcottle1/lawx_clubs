import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import LogoInput from '../../components/LogoInput'
import { PARTNER_CATEGORIES } from '../../lib/constants'
import { logoUrl, uploadLogo } from '../../lib/storage'
import { supabase } from '../../lib/supabase'
import type { Partner } from '../../lib/types'
import { Alert, Button, Card, PageHeader, Spinner } from '../../components/ui'

/** Phase 1 placeholder: profile summary + logo upload. Full dashboard in Phase 3. */
export default function PartnerHome() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('partners').select('*').eq('user_id', userId).maybeSingle()
    setPartner(data as Partner | null)
  }, [userId])
  useEffect(() => { void load() }, [load])

  async function saveLogo() {
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const path = await uploadLogo(userId, file)
      const { error } = await supabase.from('partners').update({ logo_path: path }).eq('user_id', userId)
      if (error) throw error
      // Clean up the previous file, if any.
      if (partner?.logo_path) await supabase.storage.from('logos').remove([partner.logo_path])
      setMsg({ kind: 'success', text: 'Logo saved.' })
      setFile(null)
      await load()
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message })
    }
    setBusy(false)
  }

  if (partner === undefined) return <Spinner />
  if (partner === null) return <Alert>We couldn't find your partner profile.</Alert>
  const category = PARTNER_CATEGORIES.find((c) => c.value === partner.category)?.label
  const logo = logoUrl(partner.logo_path)

  return (
    <>
      <PageHeader title={partner.name} subtitle={`${category} · ${partner.city}, ${partner.state}`} />
      {!partner.logo_path && (
        <Alert kind="warning" className="mb-4">Add a logo so clubs recognize you in the partner directory.</Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-medium">Your profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-slate-500">Open to sponsorships</dt><dd>{partner.open_to_sponsorships ? 'Yes' : 'No'}</dd></div>
            <div><dt className="text-slate-500">About</dt><dd>{partner.description || '—'}</dd></div>
            <div><dt className="text-slate-500">What you offer</dt><dd>{partner.offer_description || '—'}</dd></div>
            {partner.website && (
              <div><dt className="text-slate-500">Website</dt>
                <dd><a className="text-accent-700 hover:underline" href={partner.website} target="_blank" rel="noreferrer">{partner.website}</a></dd></div>
            )}
          </dl>
        </Card>
        <Card>
          <h2 className="font-medium">Logo</h2>
          <div className="mt-3 space-y-3">
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
            <LogoInput label={logo ? 'Replace logo' : 'Upload logo'} currentUrl={logo} onChange={setFile} />
            <Button onClick={() => void saveLogo()} disabled={!file || busy}>{busy ? 'Uploading…' : 'Save logo'}</Button>
          </div>
        </Card>
      </div>
      <Alert kind="info" className="mt-6">
        Sponsorship opportunities, proposals, and results arrive in a later phase.
      </Alert>
    </>
  )
}
