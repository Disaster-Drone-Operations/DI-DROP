export default (r) => {
  r.root('missions#index')

  r.resources('missions', () => {
    r.resources('assignments', { only: ['show', 'create', 'destroy'] })
    r.patch('/assignments/:id/complete', 'assignments#complete')
    r.patch('/assignments/:id/reopen', 'assignments#reopen')
    r.resources('comparisons', { only: ['index'] })
    r.resources('viewpoints', { only: ['update'] })
  })

  // Modul "Bilddaten"
  r.get('/media', 'media#index')

  r.get('/settings', 'settings#index')
  r.get('/settings/:section', 'settings#show')
  r.patch('/settings/:section', 'settings#update')
}
