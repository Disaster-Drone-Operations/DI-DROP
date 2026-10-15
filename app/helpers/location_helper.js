import { relayBaseUrl } from '/app/services/location_service.js'

// Is location transfer from the smartphone set up?
export const relayConfigured = () => !!relayBaseUrl()
