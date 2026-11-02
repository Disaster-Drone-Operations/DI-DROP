export default (r) => {
  r.root('missions#index')

  // Backfilling older missions from image folders and flight logs (before resources: not a mission id)
  r.get('/missions/history', 'history#index')
  r.patch('/missions/history/devices', 'history#devices')
  r.post('/missions/history', 'history#create')

  r.resources('missions', () => {
    r.resources('assignments', { only: ['show', 'create', 'destroy'] })
    r.patch('/assignments/:id/complete', 'assignments#complete')
    r.patch('/assignments/:id/reopen', 'assignments#reopen')
    r.patch('/assignments/:id/operator', 'assignments#operator')
    // Provisioning (Nextcloud, folder …)
    r.get('/assignments/:id/provide', 'provisions#new')
    r.post('/assignments/:id/provide', 'provisions#create')
    r.resources('comparisons', { only: ['index'] })
    r.resources('viewpoints', { only: ['update'] })
    // Crew: who fills which role from when on
    r.post('/crew', 'crew#create')
    r.delete('/crew/:entry', 'crew#destroy')
  })

  // Former module "Bilddaten" → redirects (images always belong to a mission)
  r.get('/media', 'media#index')

  // "Mein Standort": position from the smartphone via your own relay
  r.get('/location', 'location#show')

  // Module "Flugprotokolle" (DJI remote controller)
  r.get('/flightlogs', 'flight_logs#index')
  r.patch('/flightlogs/mission', 'flight_logs#assign')
  r.patch('/flightlogs/crew', 'flight_logs#crew')

  // Module "Akkunutzung"
  r.get('/batteries', 'batteries#index')
  r.patch('/batteries/:serial/retire', 'batteries#retire')
  r.patch('/batteries/:serial/activate', 'batteries#activate')

  // Module "Einheit": people of the drone unit
  r.get('/unit', 'people#index')
  r.post('/unit/people', 'people#create')
  r.patch('/unit/people/:id', 'people#update')
  r.post('/unit/qualifications', 'qualifications#create')
  r.patch('/unit/qualifications/:id', 'qualifications#update')
  r.delete('/unit/qualifications/:id', 'qualifications#destroy')

  r.get('/uploads', 'uploads#index')
  r.get('/about', 'about#show')

  r.get('/settings', 'settings#index')
  r.get('/settings/:section', 'settings#show')
  r.patch('/settings/:section', 'settings#update')
}
