export default (r) => {
  r.root('missions#index')

  r.resources('missions', () => {
    r.resources('flights', { only: ['create', 'destroy'] })
  })

  r.get('/settings', 'settings#index')
  r.get('/settings/:section', 'settings#show')
  r.patch('/settings/:section', 'settings#update')
}
