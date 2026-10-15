// FormData → nested object, like Rails params:
//   mission[title]=Foo&mission[team][pilot]=Bar → { mission: { title: 'Foo', team: { pilot: 'Bar' } } }

export function parseParams(formData) {
  const params = {}
  for (const [key, value] of formData.entries()) {
    const parts = key.match(/[^[\]]+/g) ?? [key]
    let node = params
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = value
      else node = node[part] ||= {}
    })
  }
  return params
}

export function parseQuery(search) {
  return parseParams(new URLSearchParams(search))
}
