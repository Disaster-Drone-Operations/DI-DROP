export default (r) => {
  r.root('missions#index')

  r.resources('missions', () => {
    r.resources('assignments', { only: ['show', 'create', 'destroy'] })
    r.patch('/assignments/:id/complete', 'assignments#complete')
    r.patch('/assignments/:id/reopen', 'assignments#reopen')
    // Provisioning (Nextcloud, folder …)
    r.get('/assignments/:id/provide', 'provisions#new')
    r.post('/assignments/:id/provide', 'provisions#create')
    r.resources('comparisons', { only: ['index'] })
    r.resources('viewpoints', { only: ['update'] })
  })

  // Module "Bilddaten" (image data)
  r.get('/media', 'media#index')

  // "Mein Standort": position from the smartphone via your own relay
  r.get('/location', 'location#show')

  // Module "Flugprotokolle" (DJI remote controller)
  r.get('/flightlogs', 'flight_logs#index')

  r.get('/uploads', 'uploads#index')
  r.get('/about', 'about#show')

  r.get('/settings', 'settings#index')
  r.get('/settings/:section', 'settings#show')
  r.patch('/settings/:section', 'settings#update')
}
