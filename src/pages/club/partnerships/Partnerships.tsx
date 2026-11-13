import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../components/ui'
import MyOpportunities from './MyOpportunities'
import PartnerDirectory from './PartnerDirectory'
import ProposalsInbox from './ProposalsInbox'

const TABS = [
  { key: 'partners', label: 'Find partners' },
  { key: 'opportunities', label: 'Your opportunities' },
  { key: 'proposals', label: 'Proposals' },
] as const

/** /club/partnerships — directory, posted opportunities, incoming proposals. */
export default function Partnerships() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'partners'
  return (
    <>
      <PageHeader title="Partnerships" subtitle="Find sponsors, post what you can offer, and respond to proposals." />
      <div role="tablist" aria-label="Partnerships" className="mb-4 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setParams({ tab: t.key })}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${tab === t.key ? 'bg-accent-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'partners' && <PartnerDirectory />}
        {tab === 'opportunities' && <MyOpportunities />}
        {tab === 'proposals' && <ProposalsInbox />}
      </div>
    </>
  )
}
