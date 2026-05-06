import Modal from './Modal.jsx'
import ItemDetailPanel from './ItemDetailPanel.jsx'

export default function SharedItemModal({ item, title, onClose, children, quantity, noted, extraInfo }) {
  if (!item) return null
  return (
    <Modal title={title || item.name} onClose={onClose}>
      <ItemDetailPanel item={item} quantity={quantity} noted={noted} extraInfo={extraInfo}>
        {children}
      </ItemDetailPanel>
    </Modal>
  )
}
