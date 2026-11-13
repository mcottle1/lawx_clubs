import { useState } from 'react'
import Modal from '../../components/Modal'
import Thread from '../../components/messaging/Thread'
import ProposalForm from '../../components/ProposalForm'
import { Button } from '../../components/ui'
import { useNavigate } from 'react-router-dom'

/** Partner's view of a conversation, with "Make a proposal" for the club's request. */
export default function PartnerThread() {
  const navigate = useNavigate()
  const [convId, setConvId] = useState<string | null>(null)
  return (
    <>
      <Thread side="partner" actions={(c) => <Button onClick={() => setConvId(c.id)}>Make a proposal</Button>} />
      <Modal open={!!convId} onClose={() => setConvId(null)} title="Make a proposal">
        {convId && <ProposalForm conversationId={convId} onDone={() => navigate('/partner/proposals', { state: { sent: true } })} />}
      </Modal>
    </>
  )
}
