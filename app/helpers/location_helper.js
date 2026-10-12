import { relayBaseUrl } from '/app/services/location_service.js'

// Ist die Standort-Übertragung vom Smartphone eingerichtet?
export const relayConfigured = () => !!relayBaseUrl()
