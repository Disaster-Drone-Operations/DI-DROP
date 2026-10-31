import { canTransfer } from '/app/services/location_service.js'

// Can the location come from the phone? (relay set up – or simulated in the training mode)
export const relayConfigured = () => canTransfer()
