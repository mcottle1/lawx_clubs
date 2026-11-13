import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../components/ui'
import MyOpportunities from './MyOpportunities'
import PartnerDirectory from './PartnerDirectory'
import PartnerFinder from './PartnerFinder'
import ProposalsInbox from './ProposalsInbox'

const TABS = [
  { key: 'finder', label: 'Partner finder' },
  { key: 'partners', label: 'All partners' },
  { key: 'opportunities', label: 'Your opportunities' },
  { key: 'proposals', label: 'Proposals' },
] as const

/** /club/partnerships — directory, posted opportunities, incoming proposals. */
export default function Partnerships() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'finder'
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
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${tab === t.key ? 'bg-accent-600 font-semibold text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-accent-50 hover:ring-accent-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'finder' && <PartnerFinder />}
        {tab === 'partners' && <PartnerDirectory />}
        {tab === 'opportunities' && <MyOpportunities />}
        {tab === 'proposals' && <ProposalsInbox />}
      </div>
    </>
  )
}
