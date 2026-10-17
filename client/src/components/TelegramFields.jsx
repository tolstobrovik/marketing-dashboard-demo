import { Send } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'
import { TELEGRAM_TYPES } from '../lib/constants.js'

// What a Telegram piece is: its item type (the copywriter's base rate) and
// whether it is a guiding post (a bonus on top — never instead). One control
// for the builder's Extras step and the sheet's Brief tab, so the two cannot
// ask it differently. Drawn only for a task going to a written channel; the
// caller decides that, from the channels' formats.
//
// The labels are spelled out here rather than read off TELEGRAM_TYPES so the
// translation gate sees every one of them asked for.
const LABEL = {
  just_post: () => tx('Just a post'),
  post_plus: () => tx('Post plus'),
  webinar: () => tx('Webinar'),
}

export default function TelegramFields({ type, guiding, onType, onGuiding, disabled = false, required = false, bad = false }) {
  return (
    <div className={'tg-fields' + (bad ? ' field-bad' : '')} data-field="telegram_type">
      <label className="brief-field tg-type">
        <span className="brief-label">
          <Send size={12} /> {tx('Telegram Item Type')}
          {required && <b className="req-star" aria-hidden="true"> *</b>}
        </span>
        <select className="select" value={type || ''} disabled={disabled} required={required}
          onChange={(e) => onType(e.target.value || null)}>
          <option value="">{tx('Pick one…')}</option>
          {TELEGRAM_TYPES.map((t) => <option key={t.key} value={t.key}>{LABEL[t.key]()}</option>)}
        </select>
      </label>
      <button type="button" className={'switch tg-guiding' + (guiding ? ' on' : '')} role="switch"
        aria-checked={!!guiding} disabled={disabled} onClick={() => onGuiding(!guiding)}>
        <i />
        <span>{tx('Guiding post (teaches)')}</span>
      </button>
    </div>
  )
}
